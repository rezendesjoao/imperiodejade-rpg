# Império de Jade — sistema para Foundry VTT

Sistema do **Império de Jade** (Tormenta RPG, Jambô) para o Foundry VTT 14. Esta primeira versão traz a **ficha de
personagem** completa e automatizada; os compêndios (raças, classes, perícias, talentos, jutsus, equipamento e
bestiário do livro) vêm nas próximas versões.

## Instalação

No Foundry, em **Sistemas de Jogo → Instalar Sistema**, cole a URL do manifesto:

```
https://github.com/rezendesjoao/imperiodejade-rpg/releases/latest/download/system.json
```

Requer o Foundry VTT **14**.

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

### Dicas

- O **pincel** no alto do trilho liga o **modo de edição** (valores base, bônus, treinos, nível, PV/PM sem classe).
- Nos campos de PV, PM, XP e moedas, digite `+5` ou `-3` para somar ou subtrair; `=7` define o valor.
- **Shift + clique** numa rolagem pergunta a condição favorável (+2) ou desfavorável (−2).
- Clique com o botão direito numa linha de item para abrir a ficha dele.

## Licença

O código é distribuído sob a licença MIT (veja `LICENSE`). *Império de Jade* e *Tormenta* são marcas da Jambô
Editora; este sistema não traz o texto do livro.
