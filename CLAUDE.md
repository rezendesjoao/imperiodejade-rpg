# Império de Jade — notas de desenvolvimento

Sistema do Foundry VTT 14 (id `imperiodejade`, repositório `rezendesjoao/imperiodejade-rpg`). Regras do livro
*Império de Jade* (Tormenta RPG): seis habilidades + Honra, perícias com graduações (nível + 3 treinada, metade do
nível sem treino), CA = 10 + ½ nível + Des (limitada) + armadura + escudo, resistências = ½ nível + mod, BBA por classe,
chacras e jutsus com custo e CD por grau.

## Onde está cada coisa
- `module/config.mjs`: todos os dados de regra (habilidades, perícias, tamanhos, Honra, violações, BBA, chacras, graus).
- `module/data/character.mjs`: o modelo do personagem; tudo que é derivado sai em `prepareDerivedData` (nunca gravado).
  Sem itens de classe, nível/BBA/PV/PM são digitados; com classes, saem delas (só a classe inicial dá os valores iniciais).
- `module/data/items.mjs`: os nove tipos de item. Números da arma que dependem do dono são getters (o ator prepara os
  itens antes dos próprios derivados).
- `module/documents/`: rolagens, Honra, descanso, PM (ator); ataque, dano, jutsu, uso (item).
- `module/dice/rolls.mjs`: os cartões de chat (`templates/chat/roll-card.hbs`) e os botões deles (dano, aplicar dano).
- `module/sheets/`: ficha de personagem (ApplicationV2, uma parte por aba) e ficha de item.
- `module/auto/`: o motor de automação (condições, efeitos com duração, usos, opções de rolagem, ataque contra a CA dos
  alvos, dano com RD/resistências/evasão/fortificação, reações, jutsus). O formato dos dados está em `docs/automacao.md`.
- `styles/imperio.css`: todo o visual; `styles/fonts.css`: Cinzel (Google Fonts), Gelasio e Noto Serif JP (embutidas).

## Compêndios
- A fonte é `src/data/*.json` (as regras do livro **resumidas com palavras próprias**, com a página). `npm run build` roda
  `tools/build-data.mjs` (gera `src/packs/<pack>/*.json` com ids estáveis, pastas, ícones e efeitos; liga classes às
  habilidades e aos talentos iniciais, raças às habilidades raciais) e `tools/packs.mjs` (compila em `packs/`, com o
  Foundry desligado). `src/packs` e `packs` não vão para o git; o zip da release leva `packs`.
- **Nenhum texto exato do livro.** Antes de cada release: `node tools/check-text.mjs <texto-do-PDF.txt> --min 10`
  tem de sair sem trechos; o texto do PDF fica fora do repositório. Créditos em `CREDITOS.md`.
- Classe e raça concedem itens ao entrar na ficha (`module/documents/grants.mjs`, flags `grantedBy`/`sourceUuid`);
  a classe inicial dá +1 de Honra por nível ganho. Efeitos de item equipável só valem equipado (`active-effect.mjs`).
- `game.imperiodejade.bookText` mostra o texto original de um módulo local que cada jogador gera do próprio PDF
  (importador fora deste repositório). O sistema nunca traz esse texto.

## Automação
- O que cada habilidade, talento, jutsu, item e criatura faz sozinho fica em `src/auto/*.json`, com a chave pelo nome
  (`"Bushi/Resolução"`, `"Foco em Arma"`, `"Oni/Garra"`); o build copia para `system.auto` e transforma os passivos em
  efeitos ativos. `node tools/check-auto.mjs` confere os blocos (e `--stats` mostra a cobertura).
- Efeito em ator de outro jogador vai pelo socket do sistema para o mestre ativo (`module/auto/effects.mjs`).
- Condições do livro são os estados do token (`module/auto/conditions.mjs`); os números saem de `conditionMods`, nunca
  de mudanças nos efeitos de condição.
- Fórmulas: `@rank` (níveis da habilidade alcançados), `@classe`, `rank()`, `lvl()`, `from()`, `dice()`, `dlvl()`.

## Regras que valem sempre
- Código e comentários em inglês; interface em `lang/pt-BR.json` (registrado também para `en`).
- Um campo `name` aparece uma vez só no formulário inteiro: as abas são partes do mesmo `<form>` e dois campos com o
  mesmo nome brigam no envio (o último ganha). Valor repetido em outra aba é só exibição.
- Kanji novo na ficha: rode de novo o recorte da Noto Serif JP (só os pedaços com os kanji usados vão no sistema).
- No Foundry 14, a mensagem de chat usa `{ messageMode }` (não `rollMode`) e apagar chave é `ForcedDeletion`.

## Teste local
- `Data/systems/imperiodejade` é uma junção para esta pasta; o mundo de teste é o `imperio-teste`.
- Servidor sem janela: o `launcher.mjs` da Eternia com `ELECTRON_RUN_AS_NODE=1` e `--port=30037 --world=imperio-teste`;
  desligue no fim (ele trava o Data inteiro).

## Release
1. `version` e `download` no `system.json`; entrada nova no CHANGELOG; `node tools/check-auto.mjs` sem problemas.
2. `node tools/package.mjs` (gera `dist/imperiodejade.zip` e `dist/system.json`).
3. Commit, push e `gh release create vX.Y.Z dist/system.json dist/imperiodejade.zip --repo rezendesjoao/imperiodejade-rpg`.
