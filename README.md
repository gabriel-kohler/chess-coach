# Chess Coach

Treinador de xadrez pessoal, local e sem assinatura. Importa suas partidas do
chess.com, revisa com o Stockfish 18 no navegador (tabuleiro e revisão no
visual do chess.com), mostra onde você perde partidas, treina tática com um
algoritmo que acompanha o seu nível, treina o seu repertório de aberturas com
repetição espaçada e treina os finais essenciais contra o motor.

Tudo roda no navegador: as partidas, análises e o progresso ficam no IndexedDB.
Nada vai para servidor nenhum.

## Rodando

```bash
npm install            # também copia o Stockfish (WASM) para public/stockfish
npm run build:puzzles  # baixa a base do Lichess (~300 MB) e monta public/puzzles
npm run dev            # http://localhost:5180
```

Na primeira abertura, informe o usuário do chess.com. A sincronização baixa
todas as partidas (6.500 levam uns 15 segundos) e depois só os meses novos.

Outros scripts:

| Comando | O que faz |
|---|---|
| `npm run build:openings` | Regera `src/data/openings.json` (nomes e teoria, lichess-org/chess-openings) |
| `npm run build:repertoire` | Compila `src/data/repertoire/*.pgn` em `public/repertoire.json`, checando cada lance com o Stockfish |
| `node scripts/eval.mjs "e4 e5 Nf3" --depth=18` | Consulta rápida ao motor numa posição |
| `npm test` | Testes (vitest) |

## Telas

- **Início**: plano do dia, alarme de tilt (duas derrotas seguidas hoje em
  rapid/blitz mandam parar) e os diagnósticos do que está custando partidas.
- **Partidas**: histórico com filtros (inclusive "ganhas que escaparam") e
  análise em lote em segundo plano.
- **Revisão**: igual à do chess.com: barra de avaliação, precisão, contagem por
  classificação, gráfico, coach lance a lance, seta do melhor lance,
  "tentar de novo" nos seus erros (a resposta é conferida pelo motor),
  "próximo erro" e exploração livre com o motor ao vivo. Atalhos: setas,
  Home/End, `f` para girar.
- **Estatísticas**: rating, tilt (depois de derrotas, posição na sessão),
  horário, dia da semana, adversários, como as partidas terminam, relógio,
  fase em que as derrotas se decidem e aberturas.
- **Aberturas**: o repertório cruzado com as suas partidas (o que você enfrenta
  em cada posição, onde você sai da linha, onde o adversário sai do
  repertório) e treino por linhas com repetição espaçada.
- **Tática**: sessões diárias montadas pelo algoritmo abaixo.
- **Finais**: 10 finais essenciais verificados com o motor. Você converte ou
  segura contra o Stockfish na força máxima.

## Como a revisão classifica os lances

A classificação usa os limiares que o chess.com publica, em pontos de chance de
vitória perdidos: melhor (0), excelente (até 2), bom (até 5), imprecisão (até
10), erro (até 20), capivarada (acima de 20). Por cima disso:

- **Brilhante**: melhor lance (ou quase) que sacrifica material (descontado o
  que o próprio lance capturou), com a posição continuando boa e sem já estar
  totalmente ganha.
- **Ótimo**: o único lance bom (o segundo melhor perde 10 pontos ou mais), desde
  que não seja captura e a partida não esteja decidida. Recapturar ou pegar
  peça solta fica como "melhor", como no chess.com.
- **Chance perdida**: o adversário tinha acabado de errar (ou havia mate) e o
  lance deixou a chance escapar.
- **Teoria**: os lances que o chess.com conta como teoria, lidos do fim do link
  da abertura da partida (`...-Old-Sicilian-Variation-3.Bc4-e6` é teoria até o
  6º meio-lance, mesmo por transposição). Sem esses lances no link, as posições
  da base de aberturas do Lichess.

A precisão do chess.com é fechada. A nossa usa o formato da fórmula do Lichess,
com as constantes ajustadas contra a precisão que o chess.com publicou em 68
das suas partidas (nível ~1350, rápidas e bullet): erro médio de 2,6 pontos por
jogador, contra 7,7 da fórmula do Lichess pura, que dava em média 4 pontos a
mais. As diferenças para o Lichess: a curva de chance de vitória é mais
achatada (no nível de clube, +3 ainda se perde, então errar numa posição ganha
continua custando), a precisão cai mais rápido por ponto perdido, e a média é
harmônica com cada lance contando no mínimo 25, então um lance desastroso pesa
como no chess.com em vez de derrubar a partida inteira. As constantes ficam em
`ACCURACY` (`src/lib/review/scoring.ts`). O modelo do chess.com depende do
rating, então o ajuste vale para esse nível.

O motor também é outro (o chess.com revisa com o Torch), então o melhor lance
às vezes difere e a contagem de "melhor" não bate exatamente.

Mudar a classificação ou a precisão não roda o motor de novo: ao abrir o app,
as análises guardadas são recalculadas a partir das linhas do Stockfish.

## O algoritmo de tática

Os puzzles vêm da base do Lichess (CC0): dos 6,1 milhões, ficam os ~2,9 milhões
bem calibrados (desvio de rating até 90, popularidade 80+, 300+ tentativas) e,
desses, 251 mil estratificados por faixa de 50 pontos e por tema. O Chess Tempo
não tem API pública e proíbe baixar os problemas, então o que ele tem de melhor
foi reproduzido aqui: rating por tema, modo sem relógio, revisão espaçada dos
erros e aceitação de lances alternativos que também ganham (conferidos pelo
motor).

Uma sessão mistura:

1. **Revisões**: puzzles errados voltam em 1, 3, 7, 16 e 35 dias, até você
   acertar de primeira quatro vezes seguidas.
2. **Seus erros**: cada partida analisada vira puzzles das posições em que você
   errou ou deixou passar uma chance.
3. **Novos, nunca abaixo do seu nível**: 55% no seu nível, 35% de +75 a +200 e
   10% de +200 a +350.

O tema de cada puzzle novo é sorteado por peso =
importância no seu rating × fraqueza no tema × tempo sem treinar ×
frequência do motivo nos erros das suas partidas. Nos temas fracos a
dificuldade puxa metade do caminho para o seu nível naquele tema. Se o acerto
nos novos passar de 62%, tudo sobe 25 pontos; abaixo de 38%, desce. O rating é
Glicko-2 (global e por tema) e só os puzzles novos contam para ele. Os
parâmetros ficam em `TRAINER` (`src/lib/tactics/trainer.ts`) e os pesos do
currículo em `src/lib/tactics/themes.ts`.

## Repertório

Os arquivos em `src/data/repertoire/*.pgn` são o repertório comentado, montado
em cima do que você já joga (e corrigindo o que os dados mostraram fraco). O
build rejeita lance ilegal, posição com duas respostas suas (inclusive por
transposição) e linha que termina num lance do adversário, e aponta cada lance
do repertório que o Stockfish considera pior que o melhor em 5 pontos de chance
de vitória ou mais.

## Fontes e licenças

- Partidas: API pública do chess.com.
- Puzzles: Lichess puzzle database (CC0).
- Aberturas: lichess-org/chess-openings (CC0).
- Motor: Stockfish 18 via stockfish.js (GPLv3), single-thread lite.
- Peças Neo e sons: carregados do CDN do chess.com para uso pessoal; se falhar,
  as peças cburnett do Lichess entram no lugar.
