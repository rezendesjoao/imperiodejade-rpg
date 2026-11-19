# Changelog

## 0.3.0 — 2026-11-19

As habilidades fazem sozinhas o que o texto diz: um motor de automação para todo o livro, com cada habilidade de classe e
de raça, talento, jutsu, item mágico e criatura codificados.

### Adicionado
- Motor de automação (`module/auto/`), com os dados de cada item em `src/auto/*.json` (formato em `docs/automacao.md`):
  - bônus que crescem com o nível da habilidade (`@rank`), desligados sem a Honra mínima ou com armadura quando a
    habilidade pede sem;
  - **usar**: variante e PM à escolha, custo, usos por rodada/cena/dia, efeitos com duração em você e nos alvos marcados,
    PV temporários, cura, recuperação, e o cartão com ataque, dano e teste de resistência; quem falha recebe a condição;
  - **opções de rolagem** no diálogo do ataque e dos testes (ataque furtivo, Ataque Poderoso, Poder Marcial, contra
    monstros, contra Honra menor...), já marcadas quando a situação vale; Alt pula o diálogo;
  - **ataque contra os alvos**: acerto ou erro contra a CA de cada um, com as condições, ataques de toque contra
    Reflexos, chance de falha, críticos; o dano vai para quem foi atingido;
  - **dano** com RD (e RD/esmagamento), resistências, imunidades, vulnerabilidade, fortificação, evasão e PV temporários;
    quem cai a 0 PV fica inconsciente e sangrando;
  - **reações** na hora certa (Hoje não, Duro de Matar, Demônio Ninja, Bateu Levou, Aparar, Vingança, Resistência
    Honrada, Dignidade de Aço) e gatilhos (Devorador de Almas);
  - **jutsus**: talentos de aprimoramento no diálogo, reduções de custo, +CD das Bênçãos, dano do Wu-Jen de Batalha,
    variante escolhida ao executar, violação de honra, "aumentar o dano" à parte;
  - **escolhas** na ficha da habilidade (estilo de combate, opções da Extorsão e da Orientação, elemento do mashin,
    arma do Foco em Arma), com os talentos e efeitos da escolha;
  - efeitos no começo do turno (dano contínuo, regeneração, teste para se livrar), sangramento, confusão e cura
    acelerada;
  - proficiência com armas e armaduras pelos talentos; Acuidade com Arma, Ataque Preciso, Na Mosca, Golpe com Duas Mãos,
    Casca Grossa.
- As 25 condições do livro no HUD do token, com as penalidades aplicadas e a regra na dica; faixa das condições na ficha.
- Ficha da Ameaça: CA e resistências já com condições e efeitos; defesas do bloco (imunidades, resistências,
  vulnerabilidade, fortificação, cura acelerada, RD/tipo) lidas do próprio texto.
- Botão "usar o poder" de armas, armaduras e acessórios; marca de automação e usos restantes na aba Habilidades; caixa
  "Faz sozinho" na ficha do item.
- "Encerrar cena" (ampulheta nos controles de token, só o mestre): efeitos de cena acabam e usos por cena voltam.
- Personagens já criados ganham a automação ao abrir o mundo (e pelo botão de engrenagem no alto da ficha).
- `tools/check-auto.mjs` confere os blocos de automação; a verificação de texto também lê os textos deles.

### Alterado
- Efeitos e dano em atores de outros jogadores passam pelo mestre ativo (socket do sistema).
- Iniciativa do controle de combate usa as opções do personagem.

## 0.2.1 — 2026-11-19

### Adicionado
- Configuração do mundo "Arquivo com o texto do livro": aponta para o `textos.json` que o importador pessoal gera do
  seu próprio PDF e foi enviado pelo navegador de arquivos. Serve para servidores hospedados, onde instalar um módulo
  novo exige reiniciar. O sistema continua sem nenhum texto do livro.

## 0.2.0 — 2026-11-19

Os compêndios do livro, com as habilidades concedidas automaticamente, e a ficha das Ameaças.

### Adicionado
- Compêndios: Raças (8), Classes (10), Habilidades de Raça, Habilidades de Classe, Talentos, Jutsus, Armas,
  Armaduras e Escudos, Equipamento e Serviços, Itens Mágicos e Bestiário, em pastas, com a página do livro em cada item.
- A raça e a classe arrastadas para a ficha concedem as suas habilidades (a classe, as de cada nível alcançado e os
  talentos iniciais da primeira classe); subir o nível da classe inicial dá +1 de Honra por nível.
- Ajustes de habilidade da raça somados ao total, com as escolhas de "+2 em duas habilidades" na ficha da raça; Honra
  da raça e da classe inicial somada à Honra.
- Efeitos automáticos de habilidades, talentos e itens (itens só equipados), e a margem de ameaça de todas as armas.
- Jutsus com dano, cura e aprimoramento de dano; botões de ataque, dano e teste de resistência com CD no cartão; o
  cartão de teste de resistência diz sucesso ou falha.
- Tipo de ator Ameaça, com ficha própria no estilo da ficha de personagem.
- `CREDITOS.md`: créditos aos autores e à Jambô; os textos dos compêndios são resumos com palavras próprias.

## 0.1.0 — 2026-11-19

A primeira versão: a ficha de personagem do Império de Jade, para testar na mesa antes dos compêndios.

### Adicionado
- Ficha de personagem em sete abas (Ficha, Perícias, Combate, Habilidades, Jutsus, Inventário, Biografia), no estilo de
  ficha impressa, com o modo de edição para os valores base.
- As sete habilidades com a Honra e a Medida de Honra; as 19 perícias com especialidades; CA, resistências, ataques,
  BBA, PV, PM e limite de PM calculados; os seis chacras.
- Itens: classe, raça, arma, armadura/escudo, equipamento, consumível, talento, habilidade e jutsu, cada um com a sua
  ficha.
- Cartões de chat para testes, ataques, dano (com aplicar dano), jutsus, habilidades, Honra e descanso.
