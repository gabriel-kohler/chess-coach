// Turns the numbers into a short list of findings, each with the evidence and
// one concrete action. Only findings the data actually supports are emitted.
import type { Account } from '../chesscom/sync.ts';
import { plural } from '../format.ts';
import type { GameAnalysis, StoredGame } from '../types.ts';
import { analysisStats, byHour, clockStats, openingTable, record, tilt } from './compute.ts';

export interface Insight {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  evidence: string;
  action: string;
}

const pct = (x: number) => `${Math.round(x)}%`;

export function buildInsights(all: StoredGame[], analyses: Map<string, GameAnalysis>, account: Account | null): Insight[] {
  const out: Insight[] = [];
  if (all.length < 20) return out;
  const serious = all.filter((g) => g.timeClass === 'rapid' || g.timeClass === 'blitz');
  const rapid = all.filter((g) => g.timeClass === 'rapid');
  const bullet = all.filter((g) => g.timeClass === 'bullet');

  // Bullet habit
  const bulletShare = bullet.length / all.length;
  const bulletRating = account?.stats.chess_bullet?.last?.rating;
  const rapidRating = account?.stats.chess_rapid?.last?.rating;
  if (bulletShare >= 0.2 && bullet.length >= 100) {
    out.push({
      id: 'bullet',
      severity: 'high',
      title: 'O bullet está treinando o hábito errado',
      evidence: `${pct(bulletShare * 100)} das suas partidas são bullet (${bullet.length}).${bulletRating && rapidRating ? ` Seu bullet está em ${bulletRating}, contra ${rapidRating} no rapid.` : ''} No bullet você decide sem calcular, que é exatamente o que acontece quando você entrega uma partida ganha no rapid.`,
      action: 'Troque o bullet por rapid mais longo (15|10 ou 30|0). Se quiser jogar rápido, no máximo uma sessão curta de blitz por semana, nunca antes de uma partida séria.',
    });
  }

  // Rating slump
  const best = account?.stats.chess_rapid?.best?.rating;
  if (best && rapidRating && best - rapidRating >= 80) {
    out.push({
      id: 'slump',
      severity: 'medium',
      title: `Você está ${best - rapidRating} pontos abaixo do seu pico no rapid`,
      evidence: `Pico ${best}, agora ${rapidRating}. Quedas assim costumam vir de jogar mais para "recuperar" do que para jogar bem.`,
      action: 'Jogue no máximo 3 partidas de rapid por sessão e pare depois de 2 derrotas seguidas. Revise cada derrota no app antes da próxima partida.',
    });
  }

  // Behavior changes over time, so habits are read from the last four months.
  const recentSince = Date.now() - 120 * 86400000;
  const recent = serious.filter((g) => g.endTime >= recentSince);
  const habits = recent.length >= 150 ? recent : serious;
  const habitsLabel = habits === recent ? 'Nos últimos 4 meses' : 'No histórico';

  // Hours
  const hours = byHour(habits).filter((h) => h.rec.n >= 40);
  if (hours.length >= 3) {
    const sorted = [...hours].sort((a, b) => a.rec.score - b.rec.score);
    const worst = sorted[0]!;
    const bestH = sorted[sorted.length - 1]!;
    if (bestH.rec.score - worst.rec.score >= 5) {
      out.push({
        id: 'hours',
        severity: 'medium',
        title: `Seu pior horário é ${worst.label}`,
        evidence: `${habitsLabel}, em rapid e blitz: ${pct(worst.rec.score)} de aproveitamento entre ${worst.label} (${worst.rec.n} partidas), contra ${pct(bestH.rec.score)} entre ${bestH.label}.`,
        action: `Nesse horário, faça tática ou revise partidas em vez de jogar valendo rating.`,
      });
    }
  }

  // Tilt
  const t = tilt(habits);
  const after2 = t.afterLosses.filter((x) => x.label === '2' || x.label === '3+');
  const after2Rec = after2.reduce((acc, x) => ({ n: acc.n + x.rec.n, pts: acc.pts + (x.rec.score * x.rec.n) / 100 }), { n: 0, pts: 0 });
  const after2Score = after2Rec.n ? (100 * after2Rec.pts) / after2Rec.n : 0;
  const base = t.afterLosses.find((x) => x.label === '0');
  const lossDrop = t.afterWin.n >= 30 && t.afterLoss.n >= 30 ? t.afterWin.score - t.afterLoss.score : 0;
  if (after2Rec.n >= 25 && base && base.rec.score - after2Score >= 6) {
    out.push({
      id: 'tilt',
      severity: 'high',
      title: 'Depois de duas derrotas seguidas você joga pior',
      evidence: `${habitsLabel}: ${pct(after2Score)} de aproveitamento depois de 2 ou mais derrotas na mesma sessão (${after2Rec.n} partidas), contra ${pct(base.rec.score)} sem derrota antes. Depois de vencer você faz ${pct(t.afterWin.score)}; depois de perder, ${pct(t.afterLoss.score)}.`,
      action: 'Regra de parada: duas derrotas seguidas encerram a sessão. A tela Início avisa quando isso acontecer.',
    });
  } else if (lossDrop >= 6) {
    out.push({
      id: 'tilt-soft',
      severity: 'medium',
      title: 'Uma derrota já derruba o seu jogo seguinte',
      evidence: `${habitsLabel}: ${pct(t.afterWin.score)} depois de vencer contra ${pct(t.afterLoss.score)} depois de perder.`,
      action: 'Depois de uma derrota, revise a partida antes de jogar a próxima. Leva 3 minutos e quebra o ciclo.',
    });
  } else if (t.longSittings >= 10) {
    out.push({
      id: 'sittings',
      severity: 'low',
      title: `${t.longSittings} sessões com 8 ou mais partidas seguidas`,
      evidence: 'Sessões longas cansam, e cansaço aparece como lances rápidos em momentos críticos.',
      action: 'Defina um número de partidas antes de começar e pare nele.',
    });
  }

  // Abandoned games
  const abandoned = serious.filter((g) => g.outcome === 'loss' && g.userResult === 'abandoned');
  if (abandoned.length >= 10) {
    const losses = serious.filter((g) => g.outcome === 'loss').length;
    out.push({
      id: 'abandoned',
      severity: 'high',
      title: `Você saiu de ${abandoned.length} partidas antes do fim`,
      evidence: `${pct((abandoned.length / losses) * 100)} das suas derrotas em rapid e blitz foram por sair da partida. Cada uma é derrota certa, e em várias ainda havia jogo.`,
      action: 'Nunca saia: se a raiva bater, desista com um clique ou jogue até o fim sem pressa. Sair vira hábito e tira pontos de graça.',
    });
  }

  // Clock
  const clock = clockStats(rapid.length >= 50 ? rapid : serious);
  if (clock) {
    if (clock.timeTroubleShare >= 0.2 && clock.scoreOutOfTrouble - clock.scoreInTrouble >= 8) {
      out.push({
        id: 'time-trouble',
        severity: 'medium',
        title: 'Aperto de tempo custa caro',
        evidence: `Em ${pct(clock.timeTroubleShare * 100)} das partidas você fica com menos de 10% do relógio. Nelas seu aproveitamento é ${pct(clock.scoreInTrouble)}, contra ${pct(clock.scoreOutOfTrouble)} nas outras.`,
        action: 'Gaste tempo nos momentos críticos (trocas, sacrifícios, finais) e jogue rápido os lances óbvios e de teoria.',
      });
    } else if (clock.fastMoveShare >= 0.3) {
      out.push({
        id: 'fast',
        severity: 'medium',
        title: 'Você joga rápido demais no meio-jogo',
        evidence: `${pct(clock.fastMoveShare * 100)} dos seus lances depois do lance 8 saem quase instantâneos, mesmo sobrando tempo no relógio.`,
        action: 'Antes de cada lance em posição com peças em contato, pergunte: quais xeques, capturas e ameaças o adversário tem depois do meu lance?',
      });
    }
  }

  // Openings with enough games that clearly underperform
  const table = openingTable(serious).filter((o) => o.rec.n >= 25);
  const overall = record(serious).score;
  const weak = table.filter((o) => o.rec.score <= overall - 7).slice(0, 2);
  for (const o of weak) {
    out.push({
      id: `opening-${o.color}-${o.name}`,
      severity: 'low',
      title: `${o.name} de ${o.color === 'white' ? 'brancas' : 'pretas'} rende abaixo da sua média`,
      evidence: `${pct(o.rec.score)} em ${o.rec.n} partidas, contra ${pct(overall)} no geral.`,
      action: 'Abra o capítulo correspondente em Aberturas e treine as linhas até o fim, com os planos.',
    });
  }

  // Engine-based
  const a = analysisStats(serious, analyses);
  if (a && a.games >= 10) {
    if (a.lossesAnalysed >= 5 && a.lostToWorse / a.lossesAnalysed >= 0.3) {
      out.push({
        id: 'lost-to-worse',
        severity: 'high',
        title: 'Você perde partidas em que jogou melhor que o adversário',
        evidence: `Em ${a.lostToWorse} de ${plural(a.lossesAnalysed, 'derrota analisada', 'derrotas analisadas')}, a precisão do adversário foi menor que a sua. A partida foi decidida por um ou dois lances, não pelo nível.`,
        action: 'Treine os seus próprios erros (Tática > Seus erros) e use a checagem de ameaças antes dos lances críticos.',
      });
    }
    if (a.thrownShare >= 0.1) {
      out.push({
        id: 'thrown',
        severity: 'high',
        title: `${plural(a.thrown.length, 'partida ganha que escapou', 'partidas ganhas que escaparam')}`,
        evidence: `Em ${pct(a.thrownShare * 100)} das partidas analisadas você chegou a ter 80% ou mais de chance de vitória e não venceu.`,
        action: 'Com vantagem, simplifique: troque peças, elimine o contra-jogo e só depois ataque. Revise essas partidas na lista de Partidas (filtro "ganhas que escaparam").',
      });
    }
    if (a.decisiveWithClock >= 5 && a.decisiveFast / a.decisiveWithClock >= 0.4) {
      out.push({
        id: 'decisive-fast',
        severity: 'high',
        title: 'Os erros que decidem as suas derrotas saem rápido',
        evidence: `${a.decisiveFast} de ${a.decisiveWithClock} erros decisivos foram jogados bem abaixo do seu tempo médio por lance${a.decisiveLowClock ? `, e só ${a.decisiveLowClock} com o relógio apertado` : ''}. Ou seja, não é falta de tempo: é pressa.`,
        action: 'Quando a posição mudar (captura, xeque, peça atacada), pare 10 segundos antes de responder.',
      });
    }
    const phases = a.decisivePhase;
    const total = phases.opening + phases.middlegame + phases.endgame;
    if (total >= 8 && phases.endgame / total >= 0.35) {
      out.push({
        id: 'endgames',
        severity: 'medium',
        title: 'Muitas derrotas se decidem no final',
        evidence: `${phases.endgame} de ${total} erros decisivos aconteceram no final.`,
        action: 'Treine os finais essenciais (oposição, Lucena, Philidor, torre contra peão) na aba Finais.',
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
