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

## A ficha

Uma página no estilo de ficha impressa — papel claro, painéis taupe, molduras de linha dupla, placas octogonais,
medalhões e escudos — com o jade, o ouro e a laca vermelha do Império. As abas ficam num trilho de seda à esquerda.

- **Ficha**: retrato com o nível, nome, classes, origem (raça, casta, religião, clã, tamanho, deslocamento) e
  experiência; as sete habilidades (Força a Carisma, mais a **Honra**) com os modificadores; Corpo a Corpo, Distância,
  Iniciativa, Percepção e Intuição; PV com temporários; **CA**, Fortitude, Reflexos e Vontade; a **Medida de Honra**;
  a armadura e o escudo vestidos e as armas em punho; PM e limite de PM, BBA, RD, Honra e descanso.
- **Perícias**: as 19 perícias do livro, com graduações (nível + 3 treinada, metade do nível sem treino), habilidade-chave,
  penalidade de armadura e as especialidades de Atuação, Conhecimento e Ofício.
- **Combate**: a fórmula da classe de armadura, os testes de resistência, os ataques, as armas e as armaduras em cartões.
- **Habilidades**: habilidades de classe, de raça e talentos, com custo em PM e Honra mínima.
- **Jutsus**: os seis chacras (abrir soma o modificador aos PM e ao limite), a tabela de graus (custo e CD) e os jutsus.
- **Inventário**: Yan de ouro, prata e cobre, os itens, consumíveis com cargas e a carga total.
- **Biografia**: dados pessoais, aparência, personalidade, história e anotações.

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

- O **pincel** no alto do trilho liga o **modo de edição** (valores base, bônus, treinos, nível, PV/PM sem classe).
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
