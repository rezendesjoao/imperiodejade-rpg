# Automação: o bloco `auto` dos itens

Toda habilidade de classe e de raça, talento, jutsu, item e habilidade de criatura pode ter um bloco `auto`, guardado
em `src/auto/*.json` com a chave pelo nome: `"Bushi/Resolução"` (classe ou raça / habilidade), `"Foco em Arma"`
(talento, jutsu, item), `"Oni/Garra"` (criatura / ataque ou habilidade). `"status": "narrativo"` ou `"parcial"` (com
`"notes"`) marca o que o sistema não faz sozinho; sem status, o bloco faz tudo o que o texto diz. O `tools/build-data.mjs` copia o bloco para `system.auto` do item
e transforma as mudanças passivas em efeitos ativos do Foundry; o motor (`module/auto/`) lê o resto na hora de rolar,
usar, aplicar dano e reagir. `node tools/check-auto.mjs` confere os blocos.

O texto da habilidade continua sendo o resumo com palavras próprias. O bloco só diz **o que o sistema faz sozinho**.
O que é só narrativo (sentir criaturas a 9m, falar com animais) fica sem bloco, ou com um `activation` que só posta o
cartão com uma `note` curta.

## Fórmulas

Número, ou texto com:

- `@for @des @con @int @sab @car @hon`: modificadores; `@honra`: o valor de Honra; `@nivel`, `@meionivel`, `@bba`;
  `@tormenta`: quantos talentos da Tormenta o personagem tem; `@pmLimit`: limite de PM.
- `@rank`: quantos dos níveis da habilidade (o campo "níveis da tabela", ex. "1, 7, 13, 19") a classe já alcançou
  (1 no primeiro). Talentos, raciais e itens: sempre 1.
- `@classe`: nível na classe da habilidade (ou nível de personagem). `@spent`: PM/dados escolhidos ao usar.
- Nos jutsus, `@dc`: a CD desta execução (com bônus de talentos); um `turnStart.save` sem `dc` usa ela.
- `@chakras.for.open` e outros sim/não valem 1 ou 0.
- Funções `floor ceil max min abs` e três atalhos:
  - `rank(2, 5, 10, 15)`: valor pelo rank (rank 1 → 2, rank 4 → 15).
  - `lvl(1:2, 8:4, 14:6)`: valor pelo nível na classe (o maior limiar alcançado; 0 abaixo do primeiro).
  - `from(5, @int)`: o valor só a partir do 5º nível na classe.
  - `dice(1d6, 1d8, 1d10)`: um dado pelo rank (só onde se espera dado: dano).
- `dlvl(2:1d4, 8:1d6, 12:1d8)`: um dado pelo nível na classe.
- Dados: `"(@rank)d6"`, `"rank(1,2,3)d6"` não funciona; use `"(rank(1,2,3))d6"` ou `"dice(1d6,2d6,3d6)"`.

## Chaves do bloco

```jsonc
"auto": {
  "passive": [ ... ],        // mudanças permanentes enquanto o item vale
  "requires": { ... },       // quando o item vale
  "traits": { ... },         // regras que o ator ganha (imunidades, evasão, proficiências...)
  "rollOptions": [ ... ],    // o que entra nas rolagens (ataque, dano, testes)
  "activation": { ... },     // o que acontece ao clicar em usar
  "reactions": [ ... ],      // botões que aparecem num momento (falhou num teste, caiu a 0 PV...)
  "triggers": [ ... ],       // o que acontece sozinho (alguém cai perto)
  "grants": [ ... ],         // itens que este item dá ao entrar na ficha
  "choice": { ... }          // escolhas feitas na ficha da habilidade (estilo, arma, opções por nível)
}
```

### passive

Lista de `{ "key": "system....", "value": <fórmula>, "mode": "override" }` (sem `mode` = soma). Valem enquanto o item
vale (equipado, Honra mínima, sem armadura quando pedido). Campos úteis do personagem:

| Campo | O que é |
|---|---|
| `system.abilities.<for…hon>.bonus` | habilidade |
| `system.skills.<pericia>.bonus` · `.ability` (override "des") | perícia |
| `system.saves.<fort/ref/von>.bonus` | resistência |
| `system.attributes.ca.bonus` · `rd` · `critBonus` (margem) · `critMult` · `armorPenaltyMod` (reduz a penalidade de armadura) | defesa e crítico |
| `system.attributes.attack.melee` · `.ranged` · `.damage` | ataque e dano |
| `system.attributes.mods.attack` · `.skills` · `.physSkills` · `.abilityTests` · `.saves` | grupos inteiros |
| `system.attributes.movement.bonus` | deslocamento (m) |
| `system.attributes.pv.bonus` · `pm.bonus` · `pm.limitBonus` | PV, PM, limite de PM |
| `system.chakras.<x>.open` (override true) · `.grade` | chacras |

Perícias: acrobacia, adestrarAnimais, atletismo, atuacao, cavalgar, conhecimento, cura, diplomacia, enganacao,
furtividade, identificarMagia, iniciativa, intimidacao, intuicao, ladinagem, obterInformacao, oficio, percepcao,
sobrevivencia.

### requires

`{ "honorMin": 16, "noArmor": true, "noShield": true, "lightArmor": true, "armorCategory": ["pesada"], "armorChosen": true }`
(`armorChosen`: só vestindo armadura da categoria marcada na escolha do item, com ids `leve`, `media`, `pesada`). O `honorMin` e o `noArmor` do próprio
item também valem. Sem o requisito, passivos, traços e opções do item ficam desligados, e usar avisa.

### traits

| Traço | Valor | Efeito |
|---|---|---|
| `evasion` | 1 ou 2 | Reflexos para metade: passou = nada; 2: falhou = metade |
| `uncannyDodge` | 1 ou 2 | não é surpreendido; 2: nem flanqueado |
| `fortification` | % | chance de ignorar o dano extra de crítico e ataque furtivo (soma, até 100) |
| `immune` | lista | `medo critico furtivo doenca veneno sono fadiga enjoo paralisia atordoamento encantamento ilusao movimento acido eletricidade fogo frio vento luz trevas vacuo` ou um id de condição |
| `resist` | `{ "fogo": 5, "energia": 10 }` | reduz o dano daquela energia (energia = todas) |
| `vulnerable` | lista de energias | dano dobrado |
| `healFrom` | lista de energias | energia mágica imune vira cura de metade (mashin) |
| `noHeal` | true | curas mágicas não funcionam |
| `autoSave` | true | passa em todo teste de resistência |
| `saveBest` | `{ "fort": "von" }` | rola as duas e fica com a melhor |
| `trainedSkills` / `untrainedSkills` | lista | conta como treinada / pode testar sem treino |
| `proficiency` | lista | `simples marcial exotica leve media pesada escudo` (talentos Usar Armas/Armaduras/Escudos) |
| `exotic` | lista de nomes | arma exótica que sabe usar (`choiceText` do Usar Arma Exótica: `["@choice"]` não; use a escolha) |
| `proficiencyShift` | 1 | marciais contam como simples, exóticas como marciais |
| `finesse` · `finesseDamage` · `rangedDexDamage` · `twoHandedStrength` · `conToCa` | true | Acuidade, Ataque Preciso, Na Mosca, Golpe com Duas Mãos, Casca Grossa |
| `unarmed` | `"dice(1d6,1d8,...)"` | dano desarmado (o maior vale) |
| `deathAtFull` · `nemMorto` | true | morre só em –PV total; em resolução, segue de pé a 0 PV |
| `reservePerScene` · `reserveHonorBonus` · `reserveExtra` | true · n · `["texto"]` | Reserva de Força |
| `touchUsesCa` | true | contra toque usa a CA em vez de Reflexos |
| `jutsuMeleeAbility` | `"sab"` | ataques corpo a corpo de jutsus com outra habilidade |
| `fastHealing` | n | PV de volta no começo de cada turno |
| `missChance` | % | chance de falha dos ataques contra quem tem |
| `seeInvisible` · `touchIncorporeal` | true | ataques contra invisíveis / incorpóreos sem chance de falha |
| `guardAllies` | n | inimigos sofrem –n nos ataques contra os aliados (Alvo Irresistível) |
| `defense` | `[{ "value": 2, "when": "vsMonster", "label": "..." }]` | CA a mais contra certos atacantes (a situação olha o atacante) |
| `retaliate` | `[{ "formula": "1d4", "type": "acido", "label": "Sangue Ácido" }]` | quem acerta corpo a corpo sofre |
| `costMods` | `[{ "value": -1, "kinds": ["jutsu","power"], "when": "inDanger" }]` ou `{ "multiply": 2 }` | custo em PM |
| `jutsuCost` · `jutsuDc` · `jutsuDamage` · `jutsuHeal` | `[{ "value": ..., "filter": {...} }]` | mexe nos jutsus |
| `jutsuCost` com `"min": 1` | | o desconto não deixa o jutsu abaixo de 1 PM (descontos de itens) |
| `jutsuGradeDown` | `[{ "filter": { "chosenJutsu": true } }]` | custa o grau abaixo (Dominar Jutsu) |
| `jutsuEnhancements` | `[{ "id", "label", "cost", "max", "effect": "maximize\|dc\|dcHonor\|note", "value" }]` | talento de aprimoramento |

### rollOptions

Cada opção aparece no diálogo da rolagem (ou entra sozinha). Campos:

- `id`, `label`; `for`: `"attack"` (padrão; vale para o dano do ataque também), `"save"`, `"skill"`, `"ability"`,
  `"initiative"`, ou lista.
- `filter`: `melee ranged unarmed light twoHanded monk ninja` (true), `weapon: "katana|wakizashi"`,
  `chosenWeapon: true` (a arma escolhida no próprio item), `chosenWeaponOf: "Arma eleita"` (a arma escrita em outra
  habilidade do personagem; "desarmado" vale para ataques desarmados), `weaponCategory`, `skills: [...]`, `saves: [...]`,
  `abilities: [...]`, `chakra`, `descriptor`, `jutsu`, `chosenJutsu`.
- Efeito: `value` (testes), `attack`, `damage` (número soma ao dano e multiplica no crítico; dado é parte extra),
  `type` (energia do dano extra), `noCrit` (não multiplica), `precision` (ataque furtivo: some com fortificação e
  imunidade a crítico), `critRange`, `critMult`, `ignoreRd` (número ou `"all"`: ignora RD e resistências).
- Custo: `cost` (PM), `pm: { "max": "@pmLimit", "attack": 2, "damage": 2, "split": true, "each": 2, "cap": "@nivel" }`
  (PM variáveis: cada PM dá attack/damage; com split, `each` por PM repartido no diálogo).
- Quando: `when` (situação; entra marcada quando vale), `locked` (com `when`: sempre aplicada e não dá para tirar),
  `optional` (sem `when`: começa desmarcada), `strict` (some quando a situação não vale), `minRank`, `minLevel`,
  `option` (só com a opção da escolha marcada).
- `extraAttack: true`: o cartão do ataque ganha o botão "Ataque extra" (Golpe Extra, Rajada, Ataque Duplo).
- No acerto: `onHit: { "gainPm": 2 }` ou `onHit: { "save": { "type": "fort", "dc": 15 }, "conditions": [{ "id": "atordoado", "duration": { "value": 1, "unit": "rodada" } }] }`.

Situações (`when`): `hpHalf hp10 hp20 inDanger vsMonster vsYoukai vsAnimal vsConstruct vsHumanoid vsLowerHonor vsDishonored
vsSordid vsInhuman vsHonored vsFlatFooted vsProne inCombat outOfCombat noArmor resolve` (`a|b` = qualquer uma).

### activation

```jsonc
"activation": {
  "cost": 1,                                   // PM (fórmula); "variable": { "min": 1, "max": "@pmLimit", "label": "Dados", "costPer": 1 } → @spent
  "action": "livre",                           // livre, padrão, movimento, completa, reação
  "uses": { "max": 1, "per": "dia" },          // rodada, cena, dia, sessao, total (cargas que não voltam)
  "consume": true,                             // gasta 1 da quantidade do item (água sagrada, bomba); funciona sem equipar
  "anywhere": true,                            // funciona sem estar equipado
  "duration": { "value": 1, "unit": "rodada" },// rodada, turno, cena, minuto, hora, dia (padrão para self/targets)
  "self": { "changes": [...], "traits": {...}, "rollOptions": [...], "conditions": [...], "key": "resolucao" },
  "tempPv": "rank(5,15,25,50)",                // PV temporários (somem com o efeito de self, se houver duração)
  "heal": "2d8+@sab", "healTargets": true,     // cura (em si; healTargets: vira o botão de cura nos alvos)
  "restore": { "pv": "2*@nivel", "pm": "@nivel" },
  "targets": {                                 // nos alvos marcados (T)
    "who": "allies",                           // allies, enemies, any
    "includeSelf": true,
    "changes": [...], "traits": {...}, "rollOptions": [...], "conditions": [{ "id": "abalado", "duration": {...} }],
    "save": { "type": "von", "dc": "15 + @nivel" },   // com save: só em quem falhar (o botão de teste aplica)
    "damage": "1d6", "pmLoss": 2,
    "variants": [{ "when": "vsHonored", "traits": {...} }]
  },
  "save": { "type": "ref", "dc": 22, "half": true, "onFail": { "conditions": [...] }, "onSuccess": {...} },
  "damage": { "formula": "(@spent)d6", "type": "luz", "healing": false, "alt": { "label": "Ferir", "type": "luz", "harm": true } },  // alt: 2º botão; harm: o 2º fere em vez de curar
  "attack": { "type": "toqueDistancia", "bonus": "from(5, @int)" },  // corpo, toque, distancia, toqueDistancia
  "honorViolation": "moderada",
  "note": "frase curta para o cartão",
  "options": [ { "id": "aviso", "label": "Aviso", "option": "aviso", "minLevel": 5, ...qualquer chave acima } ]
}
```

Sem `cost`, vale o custo do item (com `variable`, o custo é só o dos PM escolhidos). Um bloco `targets` sem `duration`
usa a do `activation`. Usar de novo substitui o efeito anterior da mesma habilidade e da mesma opção (opções
diferentes se somam).

Mais chaves de `self`, `targets` e dos `onFail`/`onSuccess`:

- `"removeConditions": ["abalado", "apavorado"]`: tira essas condições (purificação, coragem).
- `"turnStart": { "damage": "1d6", "type": "acido", "heal": "1d8", "save": { "type": "fort", "dc": 18 }, "half": true,
  "negate": true, "endOnSave": true, "conditions": [...] }`: no começo de cada turno de quem tem o efeito (dano
  contínuo, regeneração, teste para se livrar). Os números são fixados com os dados de quem usou.
- Durações e PV temporários aceitam dados: `"duration": { "value": "1d4", "unit": "rodada" }`, `"tempPv": "5d4"`.
- As condições respeitam imunidades pelos descritores do jutsu (imune a sono não dorme com um jutsu de sono).

No `save` de topo: `"half": true` (passar reduz à metade; com evasão, nada) ou `"negate": true` (passar anula o dano).
Nos jutsus, o texto da resistência decide sozinho ("metade", "anula") quando o bloco não diz.

Com `attack`, o bloco `targets` sem `save` vale só para quem o ataque acertar (o botão de ataque do cartão aplica).

Jutsus: o bloco do jutsu soma ao que ele já tem (ataque, dano, teste e CD pelo grau). `options` aparecem para escolher
ao executar (a energia, a ordem). O custo vem do grau (não ponha `cost`). `honorViolation` é cobrada ao executar. O
diálogo de execução pergunta à parte quantas vezes "aumentar o dano" (escala do próprio jutsu) e os PM de outros
aprimoramentos.

Opção de rolagem com `"best": true`: rola dois d20 e fica com o melhor.

`changes` de `self`/`targets` usam as mesmas chaves de `passive` (o valor é calculado na hora). Condições: `abalado
agarrado apavorado atordoado caido cego confuso desprevenido enjoado enredado exausto fascinado fatigado inconsciente
incorporeo indefeso inerte invisivel lento ofuscado paralisado pasmo sangrando surdo surpreendido`.

### Mais o que um bloco pode fazer (rodada 2)

Em `targets`, `self`, `onFail`/`onSuccess`, `onHit`/`onCrit`:

- `"abilityDamage": { "ability": "for", "formula": "1d6" }` (ou lista): dano de habilidade (volta 1 por dia de descanso;
  Força/Destreza 0 deixam caído e paralisado, Int/Sab/Car 0 inconsciente, Constituição 0 mata).
- `"negativeLevels": "1d4"`: níveis negativos (−1 em ataques e testes cada; 2 PV e 2 PM perdidos por nível).
- `"setPv": -1` (cai a −1 PV), `"kill": true` (morte instantânea), `"dispel": true` (tira efeitos mágicos).
- `"consumeOn": "attack" | "save" | "check" | "skill" | "ability" | "damageTaken"` (no efeito): acaba depois da próxima
  rolagem desse tipo ("só o próximo ataque") ou do próximo dano sofrido.
- `"absorb": 100` (no efeito): absorve esse tanto de dano antes dos PV e acaba quando esgota.
- `"reactions": [...]` (no efeito): reações que existem só enquanto o efeito dura; `"endEffect": true` na reação encerra o
  efeito ao usá-la.
- `turnStart.abilityDamage`: dano de habilidade a cada turno (enquanto falhar no teste, se houver).
- `damage.button: false`: o cartão não mostra o botão de dano próprio do jutsu.
- `"aura": { "radius": 9, "who": "allies", "includeSelf": true, "changes": [...], "traits": {...}, "rollOptions": [...],
  "turnStart": {...}, "conditions": [...], "label": "..." }` (em `self`): quem estiver no raio ganha uma cópia, que sai
  quando a pessoa sai do raio ou o efeito acaba.

No `activation`:

- `"extraSaves": [{ "type": "fort", "dc": 22, "label": "Veneno", "onFail": {...}, "onSuccess": {...} }]`: mais testes de
  outro tipo no mesmo cartão, cada um com o seu resultado.
- `"attack": { "weapon": true, "bonus": 2, "damage": "2d6", "damageType": "fogo", "onHit": {...}, "onCrit": {...} }`:
  golpe com a arma empunhada (`"weapon": "distancia"` para arma de disparo), com o bônus, o dano extra (não multiplica)
  e o que o acerto traz; o cartão não ganha botão de dano separado.
- `damage.extra: [{ "formula": "2d6", "type": "luz" }]` (mais partes de outros tipos), `damage.ignoreRd: 10 | "all"`,
  `damage.perTarget: [{ "when": "vsDishonored", "mult": 2, "label": "..." }]` (o dano muda conforme o alvo).

Opções de rolagem: `"onCrit": {...}` (como onHit, só no crítico); `"for": "maneuver"` com `"filter": { "maneuvers":
["agarrar"] }` (manobras: agarrar, derrubar, desarmar, empurrar, atropelar, separar; rolagem oposta contra cada alvo,
quem perde fica agarrado ou caído; a opção vale para quem faz a manobra, `"defense": true` para quem resiste, `"both"`
para os dois). Uma arma marcada como desonrada põe no cartão o botão da violação de honra; `"dishonor": "severa"` no
bloco da arma diz a gravidade (leve por padrão). Um `onCrit` com `save` só pede o teste quando houve crítico; um
`onSuccess`/`onFail` de acerto pode ter `"damage": { "formula": "5d6", "type": "vacuo" }`.

### reactions

`{ "on": "saveFailed|saveRolled|dropToZero|attacked|honorDamage|allyDown", "label", "cost", "effect", ... }` (allyDown: um aliado caiu; counterattack vai contra quem o derrubou):

| effect | Faz |
|---|---|
| `reroll` | rola de novo o teste (`saves: [...]` filtra) |
| `addBonus` | soma `value` ao resultado do teste |
| `negateDamage` | ignora o dano que derrubou |
| `stayUp` | segue consciente a 0 PV ou menos |
| `counterattack` | ataca quem atacou (`melee: true` só contra corpo a corpo) |
| `opposedAttack` | rola ataque contra o do atacante (Aparar; `ranged: true` para Desviar Objetos) |
| `opposedSkill` | rola `skill` contra o ataque (Combate Montado) |
| `reduceHonor` | devolve `value` de Honra (mínimo 1 de dano) |
| `honorTest` | teste de `skill` contra `dc`; passando, a violação não custa Honra (`severities: ["leve"]`) |

### Armas de criatura

No bloco de um ataque de criatura (ou de qualquer arma): `"damageType": "fogo"` faz o dano ser daquela energia e
`"touch": true` faz o ataque ser de toque (o alvo resiste com Reflexos). Um `onHit` com `conditions` e sem `save`
aplica as condições direto em quem foi atingido.

### triggers

`{ "on": "creatureDown", "range": 9, "gainPm": "rank(1,2)" }`.

### grants

`[{ "name": "Foco em Arma", "type": "feat" }]` (`feat`, `jutsu`, `power`, `item`): o build acha o item no compêndio.
`"choiceText": "katana"` grava a escolha no item dado; `"choiceText": "@choice"` copia o texto escolhido neste item
(e acompanha quando ele muda); `"choices": ["katana"]` já marca as opções da escolha do item dado. Um item igual já na
ficha só conta se tiver a mesma escolha.

### choice

```jsonc
"choice": {
  "label": "Estilo de combate",
  "count": 1,                         // quantas opções (fórmula: "@rank" para uma por nível da tabela)
  "text": "Arma eleita",              // pede um texto (vai para system.choiceText; filtros chosenWeapon/chosenJutsu)
  "options": [
    { "id": "iaijutsu", "label": "Iaijutsu", "grants": [...], "passive": [...], "traits": {...}, "rollOptions": [...], "reactions": [...] }
  ]
}
```

Opções escolhidas ligam os passivos, traços, opções de rolagem e concessões delas; as `activation.options` com
`option` só aparecem com a escolha marcada.

## Exemplos

Resolução (bushi): RD e PV temporários por uma cena, crescendo pelo rank.

```json
"auto": { "activation": { "cost": 1, "action": "livre", "duration": { "unit": "cena" },
  "self": { "key": "resolucao", "changes": [{ "key": "system.attributes.rd", "value": "rank(2,5,10,15)" }] },
  "tempPv": "rank(5,15,25,50)" } }
```

Ataque Furtivo (yakuza): dado extra contra desprevenido, que some com fortificação.

```json
"auto": { "rollOptions": [{ "id": "furtivo", "label": "Ataque furtivo", "damage": "(@rank)d6", "precision": true, "noCrit": true, "when": "vsFlatFooted" }] }
```

Evasão: `"auto": { "traits": { "evasion": "rank(1,2)" }, "requires": { "noArmor": true } }`.

### Rodada 2, parte final

- Filtros novos: `"jutsuExact": "Localização"` (o jutsu pelo nome inteiro; `"jutsu"` aceita parte do nome) e
  `"itemName": "grito de kiai"` (o poder em uso, para uma regra de custo de um poder só:
  `"costMods": [{ "value": -1, "kinds": ["power"], "filter": { "itemName": "grito de kiai" } }]`).
- Opções de ataque: `"autoCrit": true` (todo acerto é crítico, salvo imunes), `"touch": true` (vira ataque de toque)
  e `"noMissChance": true` (ignora a chance de falha de cegueira, camuflagem e invisibilidade).
- Manobras: a opção sem marca vale para quem faz a manobra; `"defense": true` só para quem resiste; `"both": true`
  para os dois lados (tamanho, totais de agarrar das criaturas).
- A Iniciativa (na ficha ou no combate) gasta os efeitos de "próximo teste" (`consumeOn` "check" ou "skill").
- `turnStart.ignoreRd`: o dano contínuo ignora RD (um número ou `"all"`).
- `activation.attack.onHit` / `onCrit` também valem no ataque próprio da habilidade (não só no golpe com a arma):
  o teste aparece no cartão do ataque e só pega quem foi atingido.
- `attack.weapon: "garra|mordida"` escolhe a arma do golpe pelo nome; com várias armas na mão, um diálogo pergunta
  qual (ou golpe desarmado); Shift força a pergunta.
- `traits.defense` com `"touch": true`: só contra ataques de toque (entra no teste de Reflexos).
- Arma desonrada: `"dishonor": "severa"` no bloco da arma põe a gravidade certa no botão do cartão de ataque; a arma
  não precisa de um poder só para a violação.

## Rodada 3

### Encadeamentos
- Condição com `endWith`: `{ "id": "cego", "endWith": "agarrado" }` acaba quando quem a tem perde a outra condição. Um bloco
  (`self`, `targets`) também aceita `"endWith": "caido"` (o efeito acaba quando a pessoa se levanta).
- `"consumeOn": "move"`: o efeito acaba quando o token se move (Invisibilidade Ninja).
- `activation.endEffects: ["chave"]`: usar encerra os efeitos do usuário com essa `key` (ou com esse nome): descarregar,
  trocar de modo.
- Fascinado acaba sozinho quando a criatura sofre dano.

### Ameaças
- Efeitos mudam o deslocamento (`system.attributes.movement.bonus`) e os atributos (`system.abilities.X.bonus`) também das
  Ameaças (a ficha mostra o deslocamento final).
- As perícias do texto da Ameaça ("Enganação +15") viram rolagens; as não listadas usam metade do nível + atributo.

### Flanco
- Ataque corpo a corpo com um aliado capaz de agir do lado oposto do alvo: +2 no ataque e a situação `"flanking"` (ataque
  furtivo: `"when": "vsFlatFooted|flanking"`). O traço `"noFlank": true` (e a esquiva sobrenatural aprimorada) impede.

### Testes
- `save.dc: "@damage"` num `onHit`: o teste é pedido quando o dano é aplicado, com CD igual ao dano que aquela criatura
  sofreu (Golpe Avassalador). `"@attack"`: CD igual ao resultado do ataque.
- `"onFailBy5": {...}` num `save` (ou num `onHit`): falhar por 5 ou mais traz este bloco no lugar do de falha. No
  `turnStart`: `"conditionsBy5": [...]`.
- `"immuneFor": { "value": 1, "unit": "dia" }` no bloco de sucesso (ou no `turnStart`): quem passou fica imune àquela
  fonte por esse tempo.
- `onHit`/`onCrit` com `"critImmuneSkip": true` não afetam imunes a crítico; `"natural20": true` só vale no 20 natural.

### Cura acelerada
- Traço `"noFastHealing": true` (num efeito com duração) suspende a cura acelerada (tigela vazia do kappa, Matador de
  Kaiju). Traço `"regeneration": true`: a criatura cai inconsciente em vez de morrer e a cura acelerada não cura o dano de
  acertos críticos (titãs).

### Outros traços
`"honorShift": 2` (sua Honra conta +2 contra efeitos que pegam desonrados), `"critAgainst": true` (todo acerto contra você
é crítico), `"lethalUnarmed": true` (seu ataque desarmado causa dano letal), `"powerDice": [{ "filter": { "itemName":
"canalizar energia" }, "value": 1 }]` (dados a mais no dano de um poder).

### Opções de rolagem
- Ataque: `"ignoreCritImmunity": true`, `"nonlethal": true` (dano não letal), `"ranged": true` (vira ataque à distância),
  `"weaponDice": "1d4"` (troca o dado da arma), `"weaponType": "E"` ou `"luz"` (troca o tipo de todo o dano da arma),
  `"damageMult": 2` (dano dobrado; soma com o crítico: ×2 e ×2 = ×3), `"damageSteps": 1` (o dado da arma sobe passos na
  tabela de dano por tamanho: 1d6 → 1d8 → 2d6 → 3d6...).
- Teste: `"take10": true` (escolher 10: o dado vale 10).

### Armas
- `"thrown": "3m"` no bloco de uma arma corpo a corpo: o diálogo oferece arremessar (com o ataque à distância).
- `"nonlethal": true` no bloco de uma arma: dano não letal (Ataque desarmado). Quem tem o dado desarmado de classe
  (monge) ou `lethalUnarmed` causa dano letal. Dano não letal soma à parte; igual aos PV atuais, a criatura desmaia (sem
  sangrar); cura tira o mesmo tanto e o descanso zera.

### Áreas
`activation.zone: { "radius": 6, "who": "enemies|allies|any", "includeSelf": false, "label": "...", "changes": [...],
"traits": {...}, "rollOptions": [...], "turnStart": {...}, "conditions": [...], "at": "self" }`: uma região no mapa (no
primeiro alvo marcado, em você com `"at": "self"`, ou onde o jogador clicar). Quem está dentro recebe o efeito, quem sai
perde; o `turnStart` age no começo do turno de quem está dentro. A área some quando acaba o efeito "Área" do usuário (a
duração da ativação).

### Doenças
`"disease": "Febre do esgoto"` num bloco de falha (Calafrios diabólicos, Enjoo cegante, Febre demoníaca, Febre do esgoto,
Febre do riso, Febre escarlate, Febre mental, Maldição pegajosa, Tremores) ou `{ "name", "dc", "damage": [{ "ability",
"formula" }], "cure": 2 }`. Quem contrai sofre o efeito na hora; a cada descanso faz Fortitude: falhando, sofre de novo;
dois sucessos seguidos curam (calafrios: três). `"cure": true` (ou `["disease"]`, `["poison"]`) elimina doenças e
venenos; um efeito com `"poison": true` é um veneno que dura.

### Ativação
- `"check": { "skill": "atuacao", "dc": 25 }`: o teste vem antes; falhando, nada acontece e nada é gasto.
- `"contest": { "mine": "skill:enganacao", "theirs": "skill:intuicao", "onWin": {...} }`: disputa contra cada alvo (o
  defensor fica com o empate); quem perde recebe o bloco. Lados: `skill:x`, `save:fort|ref|von`, `ability:x`, `attack`.
- `attack.critical: { "range": 19, "mult": 2 }`: o ataque próprio da habilidade ameaça crítico como uma arma; o dano sai
  no cartão do ataque (o cartão da habilidade não mostra outro botão de dano).
- `damage.drain: "tempPv" | "heal"`: quem causou ganha PV temporários (ou cura) iguais ao dano aplicado.

### Kits
Sem o kit, o teste da perícia sofre −5 sozinho (Cura e Ofício: sempre; Enganação e Ladinagem: oferecido no diálogo). Os
kits não precisam de bloco.

### Aprimoramentos de jutsu
`"effect": "extend"` (durações em rodadas, minutos, horas e dias dobram), `"ranged"` (toque vira toque à distância),
`"share"` (o efeito pessoal vai para o alvo tocado).

### Itens escritos nos dados
Uma concessão pode trazer o item inteiro em vez do nome de um item do compêndio (armas naturais):
`"grants": [{ "item": { "name": "Mordida", "type": "weapon", "system": { "kind": "corpo", "grip": "leve", "category":
"simples", "damage": "1d4", "damageType": "P", "critRange": 20, "critMult": 2, "auto": { ... } } } }]`. O item entra na
ficha com a habilidade (ou com a opção escolhida, numa `choice`) e sai com ela. `damageType`: C, P, E, CP ou PE;
`kind`: corpo, arremesso ou disparo; `grip`: leve, umaMao ou duasMaos.

### Rolar o ataque de novo
Uma opção de ataque com `"reroll": true` (e `"cost": 4`) não soma nada: põe no cartão do ataque o botão de rolar de
novo, que paga o custo e repete o mesmo ataque com as mesmas opções (sem pagar de novo o que elas custam). O segundo
resultado vale; o cartão antigo deixa de rolar dano (Mestre em Arma).

### Bônus que não acumulam
`"stack": "jade"` no bloco de um item: os passivos dele só valem se forem os mais fortes do grupo entre os itens que a
pessoa usa ("a Constituição do jade não acumula com outros objetos de jade"). O mais forte é o que soma mais.

### Ajustes da rodada 3 (bestiário)
- Passivos de itens numa Ameaça usam os campos dela: `system.attributes.movement.bonus`, `system.abilities.X.bonus`,
  CA, ataque, dano, resistências e RD vão para os bônus da Ameaça (o que ela não tem, como perícias, fica de fora).
- `activation.setScores: { "int": "3d6", "hon": "3d6" }`: rola (ou fixa) atributos do usuário, mesmo os que a Ameaça não
  tem (Despertar espírito).
- Situações com `&` (todas valem) e o nível do alvo: `"vsDishonored&vsLevelMax:5"`, `"vsLevelMin:6"`.
- `"regeneration": "full"`: a criatura nunca morre por dano (cai inconsciente e a cura acelerada a traz de volta), ao
  contrário de `true`, em que o dano de críticos não regenera.
- `"noDamage": true` no bloco de uma arma: o ataque não causa dano em PV, só o que o acerto traz (Toque do yuurei).

### Ajustes da rodada 3 (itens)
- `"consumeOn": ["move", "attack"]`: o efeito acaba no primeiro desses momentos.
- `"check": { "skill": "atuacao", "specialty": "música", "dc": 25 }`: o teste usa a especialização, se a pessoa tiver.
- `powerDice` vê o tipo do dano: `"filter": { "itemName": "canalizar energia", "descriptor": "luz" }`; vale também no botão
  de cura do poder.
- `critAgainst` (e `ignoreCritImmunity`) passam por cima da imunidade a crítico e da fortificação.
- `attack.ca: 7`: o ataque próprio da habilidade é contra essa CA (Água sagrada atirada num quadrado).
- `"restore": { "pm": "1d4" }` num bloco de alvos: devolve PV ou PM a quem recebe.
- Traço `"revealed": true`: a criatura invisível fica visível para todos (Lanterna da revelação).
- Situações pela Honra do alvo: `"vsHonorMin:10"`, `"vsHonorMax:5"` (com `&`: `"vsYoukai&vsHonorMax:5"`).

### Ajustes da rodada 3 (equipamento, classes, talentos, itens)
- O ataque próprio de uma habilidade usa a variante escolhida (o `attack` de uma `activation.options`).
- `attack.critical` mantém o `damage.extra` (o fogo da tocha), sem multiplicar.
- `"meleeUse": { "penalty": -4 }` no bloco de uma arma de arremesso: o diálogo oferece usá-la corpo a corpo.
- `"selfEffect": { "changes": [...], "duration": {...} }` numa opção de ataque: o efeito vai para quem ataca ao escolher a
  opção (bater com o escudo perde o bônus dele).
- `damageMult` de várias opções se somam (×2 e ×2 = ×3).
- Rolar de novo mantém os PM gastos nas opções e o modificador da situação.
- Jutsu Estendido (`"extend"`): cada compra soma +100% da duração em rodadas (1d4 com três compras → 4d4).
- Falhar no `check` ainda cobra a `honorViolation` do item (usar a pipa ninja).
- `self.damage: "1d6"`: dano em quem usa (Armamento da Tormenta).
- `onHit`/`onCrit` com `"selfTempPv": 10` ou `"selfDamage": 1`: o que o acerto dá ou custa a quem ataca.
- `"stack"` vale bônus a bônus: cada mudança só conta se for a maior do grupo naquele campo.
- `honorShift` só pesa contra efeitos que pegam desonrados (vsDishonored, vsSordid, vsInhuman, vsHonorMax).
- Situações `"vsLevelBelowMine"` (o alvo tem nível menor que o seu) e `"vsNdBelowLevel"` (ND do alvo menor que o seu nível).
- Itens escritos numa concessão ganham os `passive` deles como efeito.

### Ajustes da rodada 3 (jutsus)
- O ataque próprio de um jutsu leva a CD da execução: um `onHit` com `save.dc: "@dc"` funciona sem golpe de arma.
- No golpe com a arma, `attack.damage` escrito (até `"0"`) vale no lugar do dano do jutsu.
- `check` também vale para jutsus (antes de pagar).
- Uma opção com `"free": true` não custa PM nem abre o diálogo do jutsu (descarregar, voltar); `"dcDelta": 2` muda a CD
  só naquela opção.
- Traço `"noJutsus": true`: a criatura não executa jutsus enquanto durar.
- Imunidade a `"veneno"` vale para dano desse tipo; `"corte"`, `"perfuracao"`, `"esmagamento"` imunizam contra um
  tipo físico.
- As opções de rolagem guardadas num efeito fixam a CD do teste do acerto (`@dc`) na hora em que o efeito nasce.
- `"healAbility": { "ability": "for" | "all", "value": 2 | "all" }` cura dano de habilidade; `"removeNegativeLevels": 1 |
  "all"` tira níveis negativos.
- Traço `"armorFree": true` (num efeito): as habilidades que pedem estar sem armadura funcionam de armadura.
- Disputa com bônus fixo: `"theirs": "fixed:15"`.

### Ajustes finais da rodada 3
- `"who": "self"` em áreas e auras: só quem usa recebe (uma mandala em volta de você).
- O bloco `self` também cura (`cure`), cura dano de habilidade, tira níveis negativos e dissipa.
- Situações `"vsAlly"` e `"vsEnemy"` (o alvo é aliado ou inimigo de quem usa: num bloco de alvos, `variants` dão +1 aos
  aliados e −1 aos inimigos), `"vsStatus:enjoado"` (o alvo tem a condição), `"selfStatus:caido"` (você tem) e
  `"vsLevelMax:@level + @abilities.car.mod"` (nível do alvo contra uma fórmula sua).
- Traço `"ignoreConcealment": true`: seus ataques ignoram a chance de falha da camuflagem do alvo (não a cegueira).
- `damageSteps` e `damageMult` de uma opção guardada num efeito ficam fixos quando o efeito nasce (`@spent` funciona).
- `@formula`: o dano do jutsu com o aumento pago, para o que ele deixa (dano por turno, dano no próximo ataque).
- Deslocamento nunca cai abaixo de 1,5 m por efeitos (só "não pode se mover" zera).
- Reação com `"tieWins": true`: empate também evita (Mente Ausente).
- Numa opção de jutsu, `"attack": null` tira o ataque próprio do jutsu.
- Condição com `"consumeOn"`: `{ "id": "invisivel", "consumeOn": ["move", "attack"] }` acaba no primeiro desses momentos.
- Traço `"exposed": true`: a camuflagem da criatura não conta (Chuva da Revelação).
- `@formula` vale também no dano do resultado de um acerto (`onSuccess.damage`), com o aumento pago.
- `"save": false` na automação de um jutsu: o cartão não mostra o botão de teste do jutsu (o teste sai do acerto).
