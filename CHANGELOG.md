# Changelog

## 0.5.1 — 2026-11-19

### Mudado
- **Texto do livro**: com o módulo pessoal ativo (ou o arquivo configurado), as fichas, as linhas abertas de habilidades,
  talentos e jutsus e os cartões no chat mostram **só** o texto do livro no lugar do resumo do sistema, sem o quadro
  separado. Sem o módulo, nada muda. O sistema continua sem nenhum texto do livro.

## 0.5.0 — 2026-11-19

Terceira rodada da automação: 672 entradas do livro fazem tudo sozinhas (antes 544), 220 fazem em parte (antes 341) e só
138 ficam apenas no texto (antes 145). O que sobra é sobretudo o que depende do mestre (controle mental, ilusões, cenas).

### Adicionado
- **Áreas no mapa**: névoas, escuridão, chuvas, mandalas e barreiras viram regiões na cena (no alvo marcado, em você ou onde
  o jogador clicar). Quem entra ganha o efeito, quem sai perde, e a área some quando a duração acaba.
- **Flanco**: +2 no ataque corpo a corpo com um aliado do lado oposto; o ataque furtivo conta o alvo flanqueado. Criaturas
  "sem flanco" e a esquiva sobrenatural aprimorada impedem.
- **Doenças** da tabela do livro: quem falha contrai e sofre na hora; a cada descanso faz Fortitude, e dois sucessos
  seguidos curam (calafrios diabólicos: três). Purificação e Integridade Corporal curam doenças e venenos.
- **Dano não letal**: o ataque desarmado (monges batem para valer) e a Piedosa; com tanto quanto os PV, a criatura desmaia
  sem sangrar.
- **Condições encadeadas**: o cego do tsukumogami acaba quando a vítima se solta; efeitos que acabam ao se mover ou ao
  atacar; descarregar um jutsu encerra o efeito dele; fascinado acaba com dano.
- **Testes**:
  - CD igual ao dano sofrido (Golpe Avassalador) ou ao resultado do ataque;
  - efeito pior para quem falha por 5 ou mais;
  - imunidade por um dia para quem passa;
  - efeitos que não pegam imunes a crítico;
  - efeitos só no 20 natural.
- **Ameaças**:
  - efeitos e talentos mudam o deslocamento, os atributos, a CA e o ataque delas;
  - as perícias da ficha delas viram rolagens;
  - um efeito pode sortear um atributo que a Ameaça não tem (Despertar espírito).
- **Armas**:
  - arremesso (kunai, machadinha, yari) e uso corpo a corpo de armas de arremesso (azagaia);
  - troca do dado ou do tipo de dano (leque fechado, peso da corrente);
  - dano dobrado (multiplicadores se somam);
  - passos de dano (Garras do Tigre, Faixa do monge);
  - armas naturais que entram com o talento (Mordida de Rato, Braço Armado, Armamento da Tormenta);
  - botão de rolar o ataque de novo (Mestre em Arma).
- **Ativações**:
  - teste de perícia antes do efeito, que não gasta nada se falhar (Biwa encantador, Pipa Ninja);
  - disputas (finta do tengu, disputa de vontades);
  - crítico em ataque de habilidade (tocha, farpa);
  - dano que vira PV temporários (Drenar Forças);
  - recuperar PM de outra criatura;
  - curar dano de habilidade e tirar níveis negativos;
  - dano em si mesmo.
- **Cura acelerada** suspensa por efeitos (tigela vazia do kappa, Matador de Kaiju, Sasori'Ken); titãs regeneram e só o dano
  de crítico fica; kaiju voltam da queda pela cura acelerada.
- **Outros**:
  - sem o kit, a perícia sofre −5 sozinha;
  - escolher 10;
  - Jutsu Estendido, Longínquo e Compartilhado;
  - dados a mais em poderes (amuletos);
  - objetos de jade não somam Constituição entre si;
  - "não pode executar jutsus";
  - a Honra conta +2 contra efeitos que pegam desonrados;
  - todo acerto contra você é crítico (Wakizashi da Morte);
  - revelar invisíveis e anular camuflagem.

### Corrigido
- Durações em dados de efeitos deixados por um acerto agora são roladas.
- O ataque de uma habilidade com variantes usa a variante escolhida.
- O ataque próprio de um jutsu leva a CD dele para o teste do acerto.
- Rolar de novo mantém os PM gastos nas opções e o modificador da situação.
- O deslocamento não cai abaixo de 1,5 m por efeitos.

### Atualizar
Os personagens e Ameaças do mundo recebem os blocos novos do compêndio sozinhos ao abrir o mundo com a 0.5.0.

## 0.4.0 — 2026-11-19

Segunda rodada da automação. Agora 544 entradas do livro fazem tudo sozinhas (antes 463) e 341 fazem em parte (antes
354). Só 145 ficam apenas no texto (antes 213).

### Adicionado
- **Golpe com a arma**: habilidades e jutsus que atacam com a arma empunhada usam o ataque dela, com o bônus, o dano
  extra e o que o acerto traz. Com várias armas na mão, um diálogo pergunta qual (Shift força a pergunta). O efeito do
  acerto também vale no ataque próprio de uma habilidade, e o teste só pega quem foi atingido.
- **Manobras de combate** na ficha do personagem e da Ameaça (agarrar, derrubar, desarmar, empurrar, atropelar,
  separar): teste oposto contra cada alvo, e quem perde fica agarrado ou caído. Os bônus de quem faz a manobra e os de
  quem resiste contam cada um do seu lado; os de tamanho, dos dois.
- **Dano de habilidade** (venenos, drenos), com a marca na ficha; volta 1 ponto por dia de descanso. Também chegam os
  **níveis negativos**, a queda a −1 PV, a morte instantânea e o dissipar de efeitos mágicos.
- **Auras**: quem entra no raio ganha o efeito e quem sai perde.
- Vários testes no mesmo cartão (o veneno e o efeito), cada um com o seu resultado.
- Efeitos que absorvem dano, que acabam no próximo ataque, teste ou dano sofrido, e reações que só existem enquanto o
  efeito dura.
- Opções de ataque novas:
  - todo acerto é crítico (Juramento da Sasori'Ken, Mira da Última Flecha);
  - ataque de toque;
  - ignorar a chance de falha de cegueira, camuflagem e invisibilidade (Caçadora).
- **Poder mortal**: no crítico, o alvo faz Fortitude. Quem falha cai a −1 PV; quem passa sofre +5d6 de vácuo.
- Desconto de PM num poder só (o Elmo do kiai tira 1 PM do Grito de Kiai). Os amuletos descontam o jutsu pelo nome
  exato, então Localização não pega Localização Perfeita.
- Dano contínuo que ignora RD (Engolir dos kaiju) e defesa só contra ataques de toque (Manto Mucoso).
- Armas desonradas: o botão do cartão de ataque cobra a violação na gravidade do livro (ninja-to e shuriken: severa;
  kra'tann e kakko'dai: moderada).
- A Iniciativa, na ficha ou no combate, gasta os efeitos de "próximo teste".
- Durações em dados (1d4 rodadas atordoado) são roladas na hora.

### Corrigido
- O teste pedido por um crítico só aparece quando houve crítico.
- Num cartão com dois testes, só o do tipo do dano reduz o dano à metade.
- Dano por alvo que zera (mult 0) agora zera mesmo.
- Opções de manobra contavam nos dois lados; agora valem para quem faz, quem resiste ou os dois, conforme o texto.

### Atualizar
Os personagens e Ameaças que já estão no mundo recebem os blocos novos do compêndio sozinhos ao abrir o mundo com a
0.4.0.

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
