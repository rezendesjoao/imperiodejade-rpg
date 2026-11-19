import { ABILITIES, CHAKRAS, SAVES, SKILLS, VIOLATIONS, SYSTEM_ID, honorTier } from "../config.mjs";
import { d20Roll, infoCard, signed } from "../dice/rolls.mjs";
import { rollOptionsFor, situation } from "../auto/context.mjs";
import { attackRoll } from "../auto/attack.mjs";
import { reactionButtons } from "../auto/reactions.mjs";
import { resetUses } from "../auto/effects.mjs";

const L = key => game.i18n.localize(key);

/** The actor of Império de Jade: rolls, Honor, rest and spending PM. */
export class ImperioActor extends Actor {

  /** Roll data: the system data plus aliases for formulas (@for, @des... are the modifiers; @nivel, @bba). */
  getRollData() {
    const data = Object.create(this.system ?? null);
    if (this.type === "character") {
      for (const [key, ability] of Object.entries(this.system.abilities)) data[key] = ability.mod ?? 0;
      data.nivel = this.system.level ?? 1;
      data.meionivel = this.system.halfLevel ?? 0;
      data.bba = this.system.bba ?? 0;
      // Honor score (Recuperação Honrada heals as much), Tormenta feats, PM limit
      data.honra = this.system.abilities.hon?.total ?? 0;
      data.tormenta = this.system.tormenta ?? 0;
      data.pmLimit = this.system.attributes?.pm?.limit ?? data.nivel;
    } else if (this.type === "npc") {
      // The threat's numbers come ready from the stat block; the same paths as a character where formulas need them
      const sys = this.system;
      for (const [key, mod] of Object.entries(sys.mods ?? {})) data[key] = mod ?? 0;
      data.nivel = sys.level;
      data.meionivel = Math.floor(sys.level / 2);
      data.skills = { iniciativa: { total: sys.initiativeTotal ?? sys.initiative }, percepcao: { total: sys.perceptionTotal ?? sys.perception } };
      data.abilities = Object.fromEntries(Object.keys(ABILITIES).map(k => [k, { mod: sys.mods?.[k] ?? 0, total: sys.abilities[k] ?? 0 }]));
      data.honra = sys.abilities.hon ?? 0;
      data.tormenta = 0;
      data.pmLimit = Math.max(sys.level ?? 0, sys.pm?.max ?? 0);
    }
    return data;
  }

  /** New characters get a linked token with vision and the portrait as token. */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    if (this.type === "character") {
      this.updateSource({
        prototypeToken: {
          actorLink: true,
          disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
          sight: { enabled: true },
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
          displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER
        }
      });
    } else if (this.type === "npc" && !data.prototypeToken) {
      this.updateSource({
        prototypeToken: {
          actorLink: false,
          disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
          displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
          bar1: { attribute: "pv" },
          bar2: { attribute: "pm" }
        }
      });
    }
  }

  /* -------------------------------------------- */
  /*  Rolls                                       */
  /* -------------------------------------------- */

  /** Ability test (p. 223): 1d20 + modifier (with the penalties of conditions and the options of abilities). */
  async rollAbility(key, { event } = {}) {
    const isNpc = this.type === "npc";
    const score = isNpc ? this.system.abilities[key] : this.system.abilities[key]?.total;
    const mod = isNpc ? this.system.mods?.[key] : this.system.abilities[key]?.mod;
    if ((score === undefined) || (score === null) || (mod === null)) return null;
    const other = isNpc ? (this.system.checkMod ?? 0) : (this.system.abilityTestMod ?? 0);
    return d20Roll({
      actor: this, event,
      title: game.i18n.format("IJ.Roll.abilityTest", { name: L(ABILITIES[key].label) }),
      subtitle: `${L(ABILITIES[key].label)} ${score}`,
      bonus: mod + other,
      parts: [{ label: L(ABILITIES[key].abbr), value: mod }, { label: L("IJ.Auto.conditions"), value: other }],
      kanji: ABILITIES[key].kanji,
      options: rollOptionsFor(this, "ability", { ability: key })
    });
  }

  /** Skill test (p. 223): 1d20 + ranks + key ability + other bonuses. */
  async rollSkill(key, { event, specialtyId } = {}) {
    const sys = this.system;
    if (this.type === "npc") {
      if (key === "iniciativa") return this.rollInitiativeCheck({ event });
      if (key !== "percepcao") return null;
      return d20Roll({
        actor: this, event, title: game.i18n.format("IJ.Roll.skillTest", { name: L(SKILLS.percepcao.label) }),
        bonus: sys.perceptionTotal ?? sys.perception, kanji: "技", options: rollOptionsFor(this, "skill", { skill: "percepcao" })
      });
    }
    const spec = specialtyId ? sys.specialties[specialtyId] : null;
    const data = spec ?? sys.skills[key];
    const skillKey = spec?.skill ?? key;
    const skill = SKILLS[skillKey];
    if (!data || !skill) return null;
    if (!data.usable) {
      ui.notifications.warn(game.i18n.format("IJ.Roll.trainedOnly", { name: L(skill.label) }));
      return null;
    }
    const name = spec ? `${L(skill.label)} (${spec.label || "—"})` : L(skill.label);
    const subtitle = [
      data.trained ? L("IJ.Skill.trained") : L("IJ.Skill.untrained"),
      L(ABILITIES[data.ability].label)
    ].join(" · ");
    if (skillKey === "iniciativa" && !spec) return this.rollInitiativeCheck({ event });
    return d20Roll({
      actor: this, event,
      title: game.i18n.format("IJ.Roll.skillTest", { name }),
      subtitle,
      bonus: data.total,
      parts: [
        { label: L("IJ.Skill.ranks"), value: data.ranks },
        { label: L(ABILITIES[data.ability].abbr), value: data.abilityMod },
        { label: L("IJ.Skill.other"), value: data.bonus },
        { label: L("IJ.Armor.penalty"), value: data.penalty },
        { label: L("IJ.Size.label"), value: data.sizeBonus },
        { label: L("IJ.Auto.conditions"), value: data.condition ?? 0 }
      ],
      kanji: "技",
      flags: { skill: skillKey, specialtyId: specialtyId ?? null },
      options: rollOptionsFor(this, "skill", { skill: skillKey, ability: data.ability })
    });
  }

  /** Initiative: the Iniciativa skill. In a combat, it sets the combatant's initiative. */
  async rollInitiativeCheck({ event } = {}) {
    const combat = game.combat;
    if (combat?.combatants.some(c => c.actor === this)) {
      return this.rollInitiative({ createCombatants: false, rerollInitiative: true });
    }
    if (this.type === "npc") {
      return d20Roll({ actor: this, event, kind: "initiative", title: L("IJ.Skill.iniciativa"), bonus: this.system.initiativeTotal ?? this.system.initiative, kanji: "速" });
    }
    const data = this.system.skills.iniciativa;
    return d20Roll({
      actor: this, event, kind: "initiative",
      title: L("IJ.Skill.iniciativa"),
      subtitle: L(ABILITIES[data.ability].label),
      bonus: data.total,
      parts: [
        { label: L("IJ.Skill.ranks"), value: data.ranks },
        { label: L(ABILITIES[data.ability].abbr), value: data.abilityMod },
        { label: L("IJ.Skill.other"), value: data.bonus },
        { label: L("IJ.Auto.conditions"), value: data.condition ?? 0 }
      ],
      kanji: "速",
      options: rollOptionsFor(this, "initiative", { skill: "iniciativa" })
    });
  }

  /**
   * Saving throw (p. 78): 1d20 + ability modifier + half level, with the conditions and effects on it.
   * @param {string} key                 fort, ref or von
   * @param {object} [options]
   * @param {number} [options.dc]        The DC to beat: the card says success or failure (natural 1 and 20 decide, p. 78)
   * @param {string} [options.source]    What forced the test (a jutsu name), shown on the card
   * @param {string} [options.sourceId]  The card that asked for it: failing applies what that card says
   * @param {Actor} [options.sourceActor] Who caused it (Resistente a Monstros: +2 against monsters)
   * @param {string} [options.reroll]    Name of the reaction that rolls it again
   */
  async rollSave(key, { event, dc = null, source = "", sourceId = null, sourceActor = null, reroll = null, saveIndex = 0 } = {}) {
    const save = this.system.saves[key];
    if (save === undefined) return null;
    const isNpc = this.type === "npc";
    const traits = this.system.traits ?? {};
    const subtitle = [reroll ?? "", source, isNpc ? "" : L(ABILITIES[save.ability].label), dc ? `${L("IJ.Jutsu.dc")} ${dc}` : ""].filterJoin(" · ");
    const total = isNpc ? (this.system.saveTotals?.[key] ?? save) : save.total;
    // Mente Sobre a Matéria: Fortitude rolls Vontade alongside and keeps the better
    const bestKey = traits.saveBest?.[key] ?? null;
    const bestOf = bestKey ? (isNpc ? (this.system.saveTotals?.[bestKey] ?? 0) : this.system.saves[bestKey].total) : null;
    // Helpless creatures can't make Reflexos tests (p. 251)
    const helpless = (key === "ref") && !!this.statuses?.has?.("indefeso");
    const message = await d20Roll({
      actor: this, event, kind: "save", dc: helpless ? (dc ?? 99) : dc,
      title: game.i18n.format("IJ.Roll.saveTest", { name: L(SAVES[key].label) }),
      subtitle,
      bonus: helpless ? -99 : total,
      parts: isNpc ? [] : [
        { label: L("IJ.Level.half"), value: this.system.halfLevel },
        { label: L(ABILITIES[save.ability].abbr), value: save.mod },
        { label: L("IJ.Skill.other"), value: save.bonus },
        { label: L("IJ.Auto.conditions"), value: save.condition ?? 0 }
      ],
      kanji: "守",
      bestOf, bestLabel: bestKey ? L(SAVES[bestKey].label) : "",
      autoSuccess: !!traits.autoSave,
      options: rollOptionsFor(this, "save", { save: key, target: sourceActor }),
      flags: { save: key, source: sourceId, sourceName: source },
      after: ({ total: rolled, success }) => {
        const payload = { save: key, dc, total: rolled, source, sourceId };
        const buttons = [];
        if (success === false) buttons.push(...reactionButtons(this, "saveFailed", payload));
        buttons.push(...reactionButtons(this, "saveRolled", payload));
        return buttons;
      }
    });
    // A card asked for it: failing (or passing) applies what that card says
    const success = message?.flags?.[SYSTEM_ID]?.success;
    if (sourceId && (success !== null) && (success !== undefined)) {
      const sourceMsg = game.messages.get(sourceId);
      if (sourceMsg) {
        const { onSaveResult, onHitSave } = await import("../auto/activation.mjs");
        if (sourceMsg.flags?.[SYSTEM_ID]?.attack) await onHitSave(sourceMsg, this, success);
        else await onSaveResult(sourceMsg, this, success, saveIndex);
      }
    }
    return message;
  }

  /** A combat maneuver (agarrar, derrubar, desarmar, empurrar, atropelar, separar) against the targets. */
  async rollManeuver(kind = "agarrar", { event } = {}) {
    const { maneuverRoll } = await import("../auto/attack.mjs");
    return maneuverRoll(this, kind, { event });
  }

  /** A plain attack roll without a weapon (melee or ranged), from the attack medallions; unarmed damage in melee. */
  async rollPlainAttack(type = "melee", { event, target = null, extraOptions = [] } = {}) {
    const sys = this.system;
    const ability = type === "melee" ? "for" : "des";
    const unarmed = sys.traits?.unarmed || "1d3";
    const str = sys.abilities?.for?.mod ?? 0;
    const damageFormula = (type === "melee")
      ? `${unarmed}${str ? ` ${str > 0 ? "+" : "-"} ${Math.abs(str)}` : ""}${sys.attack?.damage ? ` + ${sys.attack.damage}` : ""}`
      : null;
    return attackRoll({
      actor: this, event, target, extraOptions, ranged: type !== "melee", unarmed: type === "melee",
      title: L(type === "melee" ? "IJ.Attack.melee" : "IJ.Attack.ranged"),
      subtitle: type === "melee" ? `${L("IJ.Attack.unarmed")} · ${damageFormula}` : L("IJ.Attack.noWeapon"),
      bonus: sys.attack[type],
      parts: [
        { label: L("IJ.BBA.abbr"), value: sys.bba },
        { label: L(ABILITIES[ability].abbr), value: sys.abilities[ability].mod },
        { label: L("IJ.Size.label"), value: sys.size.attack },
        { label: L("IJ.Skill.other"), value: sys.attributes.attack[type] }
      ],
      damage: damageFormula ? { formula: damageFormula, type: "E" } : null,
      kanji: "攻"
    });
  }

  /* -------------------------------------------- */
  /*  Honor                                       */
  /* -------------------------------------------- */

  /**
   * An Honor violation (p. 82-84): rolls the Honor damage unless the character's Measure of Honor ignores it.
   * @param {"leve"|"moderada"|"severa"|"extrema"} severity
   * @param {object} [options]
   * @param {boolean} [options.fixed=false]  Use the optional fixed damage (p. 84)
   */
  async honorViolation(severity, { fixed = false } = {}) {
    const violation = VIOLATIONS[severity];
    if (!violation) return null;
    const hon = this.system.abilities.hon;
    const tier = honorTier(hon.total);
    const title = game.i18n.format("IJ.Honor.violationTitle", { severity: L(violation.label) });
    if (tier.immune.includes(severity)) {
      return infoCard({
        actor: this, title, kanji: "誉", kind: "honor",
        subtitle: L(tier.label),
        body: `<p>${game.i18n.format("IJ.Honor.immune", { tier: L(tier.label) })}</p>`
      });
    }
    let loss = violation.fixed;
    let rollHTML = "";
    if (!fixed) {
      const roll = await new Roll(violation.formula).evaluate();
      loss = roll.total;
      rollHTML = await roll.render();
    }
    const value = Math.max(0, hon.value - loss);
    await this.update({ "system.abilities.hon.value": value });
    const after = honorTier(value + hon.bonus);
    const changed = after.key !== tier.key;
    return infoCard({
      actor: this, title, kanji: "誉", kind: "honor",
      subtitle: `${L("IJ.Ability.hon")} ${hon.total} → ${value + hon.bonus}`,
      body: `${rollHTML}<p>${game.i18n.format("IJ.Honor.lost", { n: loss })}</p>`
        + (changed ? `<p class="ij-card-alert">${game.i18n.format("IJ.Honor.tierChanged", { tier: L(after.label) })}</p>` : ""),
      // Dignidade de Aço, Bênção de Okoreeji: answer the violation
      buttons: reactionButtons(this, "honorDamage", { severity, loss })
    });
  }

  /** Gain Honor (p. 84-86). */
  async honorGain(amount = 1, reason = "") {
    const hon = this.system.abilities.hon;
    const value = hon.value + amount;
    await this.update({ "system.abilities.hon.value": value });
    const after = honorTier(value + hon.bonus);
    return infoCard({
      actor: this, kind: "honor", kanji: "誉",
      title: L("IJ.Honor.gainTitle"),
      subtitle: `${L("IJ.Ability.hon")} ${hon.total} → ${value + hon.bonus} · ${L(after.label)}`,
      body: reason ? `<p>${foundry.utils.escapeHTML(reason)}</p>` : ""
    });
  }

  /**
   * Use the Reserve of Strength (p. 86): once per session (per scene with Honra Absoluta), only with a positive Honor
   * modifier. Bênção de Hikari counts Honor 4 higher.
   */
  async useHonorReserve() {
    const sys = this.system;
    if (sys.abilities.hon.mod <= 0) return ui.notifications.warn(L("IJ.Honor.reserveNoMod"));
    if (sys.honor.reserveUsed) return ui.notifications.warn(L("IJ.Honor.reserveUsedWarn"));
    await this.update({ "system.honor.reserveUsed": true });
    const boost = sys.traits?.reserveHonorBonus ?? 0;
    const honorScore = sys.abilities.hon.total + boost;
    const honorMod = Math.floor((honorScore - 10) / 2);
    const bonus = honorMod * 2;
    const heal = honorScore * (sys.level >= 15 ? 3 : sys.level >= 7 ? 2 : 1);
    const list = [
      game.i18n.format("IJ.Honor.reserveOpt1", { n: signed(bonus) }),
      game.i18n.format("IJ.Honor.reserveOpt2", { n: signed(bonus) }),
      game.i18n.format("IJ.Honor.reserveOpt3", { n: signed(bonus) }),
      game.i18n.format("IJ.Honor.reserveOpt4", { n: heal }),
      L("IJ.Honor.reserveOpt5"),
      game.i18n.format("IJ.Honor.reserveOpt6", { n: signed(honorMod) }),
      // Ajuda dos Ancestrais: the jutsu conselhos dos ancestrais for free
      ...(sys.traits?.reserveExtra ?? []).map(t => (typeof t === "string" ? t : t.label ?? ""))
    ].filter(Boolean);
    return infoCard({
      actor: this, kind: "honor", kanji: "誉",
      title: L("IJ.Honor.reserve"),
      subtitle: L(sys.honorTier.label),
      body: `<p>${L("IJ.Honor.reserveChoose")}</p><ul>${list.map(i => `<li>${i}</li>`).join("")}</ul>`
    });
  }

  /* -------------------------------------------- */
  /*  Resources                                   */
  /* -------------------------------------------- */

  /**
   * Spend PM. Warns and returns false when there aren't enough.
   * @param {number} amount
   */
  async spendPm(amount) {
    const isNpc = this.type === "npc";
    const pm = isNpc ? this.system.pm : this.system.attributes.pm;
    if (amount > pm.value) {
      ui.notifications.warn(game.i18n.format("IJ.PM.notEnough", { n: amount, have: pm.value }));
      return false;
    }
    await this.update({ [isNpc ? "system.pm.value" : "system.attributes.pm.value"]: pm.value - amount });
    return true;
  }

  /** The most PM that can go into one jutsu or ability (p. 161); a threat uses its level or its PM. */
  get pmLimit() {
    if (this.type === "npc") return Math.max(this.system.level ?? 0, this.system.pm?.max ?? 0);
    return this.system.attributes?.pm?.limit ?? 0;
  }

  /** A night of rest (p. 77, 234): all PM back, and 1 PV per character level. */
  async rest() {
    const sys = this.system;
    const pv = sys.attributes.pv;
    const pm = sys.attributes.pm;
    const healed = Math.max(0, Math.min(pv.max, pv.value + sys.level) - pv.value);
    await this.update({
      "system.attributes.pv.value": pv.value + healed,
      "system.attributes.pm.value": pm.max
    });
    // Uses per day (and per scene) come back; 1 point of each damaged ability
    await resetUses(this, ["dia", "cena", "rodada"]);
    const { recoverAbilityDamage } = await import("../auto/extras.mjs");
    await recoverAbilityDamage(this);
    return infoCard({
      actor: this, kind: "rest", kanji: "休",
      title: L("IJ.Rest.title"),
      body: `<p>${game.i18n.format("IJ.Rest.body", { pv: healed, pm: pm.max - pm.value })}</p>`
    });
  }

  /** The chakras that are open, with their labels (for the jutsu cards). */
  get openChakras() {
    return Object.entries(this.system.chakras ?? {}).filter(([, c]) => c.open).map(([k]) => L(CHAKRAS[k].label));
  }
}

export { SYSTEM_ID };
