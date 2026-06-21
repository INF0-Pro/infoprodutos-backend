class PaymentMatcher {

  /**
   * Score engine puro (sem DB, sem side effects)
   */
  scoreCandidates(candidates, amount) {
    const nowMs = Date.now();

    return candidates.map(session => {
      let score = 0;

      // base
      score += 50;

      // activity bonus
      const lastActivity = new Date(session.last_activity_at).getTime();
      const diffMinutes = (nowMs - lastActivity) / 60000;

      if (diffMinutes < 2) score += 20;
      else if (diffMinutes < 5) score += 10;
      else if (diffMinutes < 10) score += 5;

      // session age
      const ageMinutes = (nowMs - new Date(session.created_at).getTime()) / 60000;

      if (ageMinutes < 5) score += 15;
      if (ageMinutes > 10) score -= 30;

      // reference match
      if (session.copied_reference) score += 30;

      // amount precision
      if (Math.abs(session.expected_amount - amount) < 0.01) {
        score += 25;
      }

      return {
        session,
        score
      };
    });
  }

  /**
   * Escolher melhor sessão
   */
  pickBest(scored) {
    if (!scored || scored.length === 0) {
      return { matched: false, reason: 'NO_CANDIDATES' };
    }

    scored.sort((a, b) => b.score - a.score);

    // ambiguidade
    if (
      scored.length > 1 &&
      scored[0].score === scored[1].score
    ) {
      return {
        matched: false,
        reason: 'AMBIGUITY',
        tied: scored.filter(s => s.score === scored[0].score)
      };
    }

    return {
      matched: true,
      best: scored[0]
    };
  }
}

module.exports = new PaymentMatcher();