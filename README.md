# Império de Jade — sistema para Foundry VTT

Sistema do **Império de Jade** (Tormenta RPG, Jambô) para o Foundry VTT 14: a **ficha de personagem** completa e
automatizada, a ficha das **Ameaças** do bestiário e os **compêndios do livro** — raças, classes com as habilidades por
nível, talentos, jutsus, armas, armaduras, equipamento, itens mágicos e criaturas.

## Instalação

No Foundry, em **Sistemas de Jogo → Instalar Sistema**, cole a URL do manifesto:

```
https://github.com/rezendesjoao/imperiodejade-rpg/releases/latest/download/system.json
```

Requer o Foundry VTT **14**.

## Os compêndios

Na aba Compêndios, a pasta **Império de Jade** traz: Raças, Classes, Habilidades de Raça, Habilidades de Classe,
Talentos, Jutsus, Armas, Armaduras e Escudos, Equipamento e Serviços, Itens Mágicos e o Bestiário (só o Mestre vê).

- **Arraste a raça e a classe para a ficha** e elas trazem o resto: a raça concede as habilidades de raça (e os ajustes
  de habilidade, inclusive os "+2 em duas à escolha", marcados na ficha da raça); a classe concede as habilidades de
  cada nível e, se for a primeira, os talentos iniciais. Ao subir o nível da classe, as habilidades novas chegam e a
  classe inicial dá +1 de Honra por nível. Tirar a classe ou a raça tira o que elas deram.
- Bônus fixos entram sozinhos (+4 em Percepção do Faro, +2 nas resistências da Sorte Ancestral, chacras abertos,
  margem de ameaça do vanara, bônus de itens mágicos enquanto equipados).
- Os **jutsus** sabem o próprio dano e o aprimoramento "aumenta o dano": os PM extras viram dados no botão de dano do
  cartão. O cartão também traz o ataque do jutsu e o botão do teste de resistência com a CD, que cada jogador rola com o
  seu token selecionado.
- As **Ameaças** chegam com ataques, habilidades especiais e jutsus prontos para clicar.
- Os textos são **resumos com palavras próprias**, com a página do livro em cada item: o livro continua necessário para
  jogar. Veja `CREDITOS.md`.

## Assistente de criação

Ao abrir a ficha de um personagem em branco, o assistente de criação aparece e monta o personagem de 1º nível nos oito
passos do livro — raça, classe, habilidades (pontos, 4d6 ou valores da mesa, Honra incluída), perícias, talentos (com os
pré-requisitos conferidos), jutsus, casta e equipamento, e os toques finais. Ao lado de cada passo, o personagem como
está, com os números da própria ficha. No fim, tudo entra de uma vez: raça, classe e o que elas dão (com as escolhas
feitas), talentos, jutsus, equipamento vestido, dinheiro, PV e PM cheios, e as violações de honra da criação com o dano
fixo do livro. O botão **Assistente de criação** no cabeçalho da ficha reabre (ou refaz) um personagem de 1º nível; as
configurações do sistema dizem se ele abre sozinho e que métodos de geração os jogadores podem usar.

## Assistente de subida de nível

Quando a experiência basta para o próximo nível, o assistente de nível abre sozinho (ou pelo botão de subir de nível da
ficha) e pede, em ordem, só o que esse nível pede: a classe (seguir nela ou multiclasse, com a violação de honra e a
perícia ou talento inicial da classe nova), as escolhas das habilidades que chegam e das que crescem, o talento ou +1
em uma habilidade e os talentos da classe, os jutsus novos e as perícias que um +1 em Inteligência traz. O resumo mostra
os números antes e depois; só então tudo entra na ficha, com os PV e PM ganhos, o +1 de Honra da classe inicial e um
cartão no chat.

## A ficha

Uma folha de papel washi numa bandeja de laca de jade, com os kanji a pincel. As abas são selos num trilho à esquerda
(a aberta fica carimbada em vermelho) e o **cabeçalho** acompanha todas elas: retrato com o selo do nível, nome, raça
e classes, PV e PM em pinceladas, a **CA** numa guarda de espada, condições e descanso.

Uma regra só para os números: **pedra de jade rola o dado, pedra índigo gasta PM**, o resto é tinta.

- **Ficha**: a **Honra numa katana** (a lâmina brilha até onde o valor chega; as marcas são onde cada Medida de Honra
  começa), com a Reserva de Força, as violações e o +1; as seis habilidades; as 19 perícias (as treinadas ganham uma
  pedra) com as especialidades de Atuação, Conhecimento e Ofício; resistências, ataques, armas em punho, armadura e a
  conta da CA; manobras; efeitos em curso; as técnicas que gastam PM ou têm usos, os jutsus e os consumíveis.
- **Caminho**: cada classe é um **bambu** que cresce de baixo para cima, um gomo por nível, com as habilidades como
  folhas e a raça como raiz (os próximos níveis aparecem em contorno; dá para ver a trilha inteira até o 20º). Os
  talentos são um **galho florido**: cada um nasce do talento que exige; os **brotos** mostram o que cada talento libera.
- **Jutsus**: os seis chacras num **lótus** (pétala de jade: aberto; o anel do miolo: PM que restam), o limite de PM,
  a tabela de graus e os jutsus de cada chacra, grau por grau.
- **Equipamento**: Yan de ouro, prata e cobre, armas, armaduras, equipamentos e consumíveis com cargas, e a carga total.
- **Biografia**: dados pessoais, aparência, personalidade, história e anotações.

Em Caminho, Jutsus e Equipamento, um clique no nome desenrola o item num **pergaminho ao lado**, com o texto e os
botões de usar, abrir e apagar.

### O que é automático

- Modificadores, graduações e totais das perícias; CA (10 + ½ nível + Des limitada pela armadura + armadura + escudo +
  tamanho); resistências (½ nível + modificador); ataques (BBA + For / Des); limite de PM (nível + chacras abertos).
- Com **itens de classe** na ficha, o nível, o BBA (total, 3/4 ou 1/2), os PV e os PM saem das classes (multiclasse
  incluída: só a primeira classe dá os valores iniciais). Sem classe, esses números são digitados no modo de edição.
- **Honra**: a Medida de Honra (Digníssimo a Desumano), a **violação de honra** que rola o dano de Honra e respeita quem
  ignora violações leves/moderadas/severas (Shift: dano fixo), +1 de Honra e a **Reserva de Força** (uma vez por sessão).
- Rolagens em cartões de chat: testes de habilidade, perícia e resistência, ataques com ameaça de crítico, dano normal
  e crítico (multiplica dados e modificadores), **aplicar dano** aos tokens selecionados (PV temporários primeiro, menos a
  RD), jutsus que gastam PM e perguntam os PM extras dos aprimoramentos até o limite, habilidades que gastam PM.
- Iniciativa pela perícia Iniciativa; **descanso** recupera os PM e 1 PV por nível.

### As habilidades fazem sozinhas o que o texto diz

- **Bônus que crescem com o nível** (Esquiva Engenhosa, Passo do Ninja, Fortificação) e bônus de itens equipados,
  desligados quando a Honra fica abaixo do mínimo ou quando a habilidade pede sem armadura.
- **Usar** uma habilidade, talento, item ou jutsu: escolhe a variante e os PM, paga PM e usos (por rodada, cena ou dia),
  aplica o efeito em você (com duração: uma rodada, a cena) e nos alvos marcados, e o cartão traz os botões de ataque,
  dano e teste de resistência. O teste de quem falhar aplica a condição sozinho.
- **Opções de rolagem**: ataque furtivo, Ataque Poderoso, Poder Marcial, Golpe Ninja, bônus contra monstros ou contra quem
  tem Honra menor aparecem no diálogo do ataque (Alt pula o diálogo), já marcadas quando a situação vale.
- **Ataque contra os alvos marcados**: acerto ou erro contra a CA de cada um (caído, desprevenido, cego e as outras
  condições do livro contam), crítico, chance de falha; o dano vai só para quem foi atingido.
- **Dano**: RD (e RD/esmagamento), resistências, imunidades, vulnerabilidade, fortificação contra crítico e ataque
  furtivo, evasão nos testes de Reflexos, PV temporários primeiro. Quem cai a 0 PV fica inconsciente e sangrando.
- **Reações**: os botões aparecem na hora certa ("Hoje não" ao falhar num teste, "Duro de Matar" ao cair, "Bateu levou"
  ao ser atacado, "Vingança" quando um aliado cai).
- **Condições** no HUD do token, com as penalidades aplicadas; sangramento, confusão e cura acelerada no começo do turno.
- **Jutsus**: talentos de aprimoramento no diálogo (Maximizado, Irresistível, Acelerado...), reduções de custo dos truques
  ninjas e do Escolhido Celestial, +2 de CD das Bênçãos, dano do Wu-Jen de Batalha.
- **Escolhas** na ficha da habilidade (estilo de combate, opções da Extorsão, elemento do mashin): os talentos e efeitos
  da escolha chegam sozinhos. O mestre encerra a cena pelo botão da ampulheta nos controles de token.

### Dicas

- O **pincel** (書) ao pé do trilho liga o **modo de edição**: valores base, bônus, treinar perícias, abrir chacras,
  origem, nível e PV/PM sem classe.
- A **pedra** de uma técnica ou jutsu usa; o nome mostra o texto; **duplo clique** no nome também usa.
- Nos campos de PV, PM, XP e moedas, digite `+5` ou `-3` para somar ou subtrair; `=7` define o valor.
- **Shift + clique** numa rolagem pergunta a condição favorável (+2) ou desfavorável (−2).
- Clique com o botão direito numa linha de item para abrir a ficha dele.

## Desenvolvimento

Os compêndios saem de `src/data/*.json` (as regras do livro, resumidas). `npm run build` gera os documentos e compila
os pacotes; `node tools/check-text.mjs <texto-do-livro.txt>` confere que nenhum trecho repete o texto do livro.

## Créditos e licença

*Império de Jade* (Jambô Editora, 2018) é de Marcelo Cassaro, Guilherme Dei Svaldi e Álvaro Freitas; *Tormenta* e
todos os nomes do cenário pertencem aos seus autores e à Jambô. Este é um projeto de fãs, sem vínculo com a editora,
e não traz o texto do livro (veja `CREDITOS.md`). O código é distribuído sob a licença MIT (veja `LICENSE`).
