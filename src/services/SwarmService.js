/**
 * SwarmService — VERALTET (deprecated seit v1.8.3)
 *
 * Bitte SwarmServiceV2 verwenden. Diese Datei existiert nur noch
 * zur Rückwärtskompatibilität mit alten Plugin-Code.
 *
 * SwarmServiceV2 bietet:
 *  - Spezialisierte Agenten-Rollen (Researcher, Critic, Coder, ...)
 *  - Inter-Agent-Kommunikation
 *  - Multi-Phase-Pipelines
 *  - Voting & Consensus
 *  - Swarm-Gedächtnis
 */

const SwarmServiceV2 = require('./SwarmServiceV2');

// Re-export V2 unter altem Namen für Rückwärtskompatibilität
module.exports = SwarmServiceV2;
