/**
 * AgentManagerSQLitePatch — DEPRECATED seit v1.8.6
 *
 * Die SQLite-Persistenz-Methoden (saveConversationMarkdown, loadConversation,
 * getConversations) sind seit v1.8.6 direkt in AgentManager integriert.
 * Dieser Patch prüft ob die Methoden schon vorhanden sind, und überspringt
 * sie stillschweigend — für vollständige Rückwärtskompatibilität mit main.js.
 */
'use strict';

function apply(agentManager) {
  if (!agentManager) return;
  // v1.8.6: Methoden sind bereits direkt im AgentManager.
  // apply() ist ein No-op und bleibt nur für Abwärtskompatibilität erhalten.
  console.log('[AgentManagerSQLitePatch] Patch übersprungen — Methoden direkt in AgentManager integriert (v1.8.6)');
}

module.exports = { apply };
