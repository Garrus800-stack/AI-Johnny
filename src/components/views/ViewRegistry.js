/**
 * ViewRegistry v2.0 — Thin Router
 *
 * v2.0: Views sind in 5 logische Module aufgeteilt:
 *   ViewsCore.js      — Chat, Dashboard, Agents, Models, Settings, Tasks
 *   ViewsTools.js     — Sandbox, ImageGen, Video, RAG, Skills, Marketplace
 *   ViewsSystem.js    — Communication, Monitoring, Collaboration, Docker, Swarm, Gateway
 *   ViewsAdvanced.js  — EmotionAI, CreativeWriting, EnhancedVision, TimeSeries, IntegrationHub
 *   ViewsAutomation.js— Heartbeat, SmartHome, Integrations
 *
 * Dieses File ist nur noch ein Router der alle Views zusammenführt.
 * Jedes Modul kann unabhängig bearbeitet werden ohne andere Views zu brechen.
 */
'use strict';

const { createCoreViews }       = require('./ViewsCore');
const { createToolViews }       = require('./ViewsTools');
const { createSystemViews }     = require('./ViewsSystem');
const { createAdvancedViews }   = require('./ViewsAdvanced');
const { createAutomationViews } = require('./ViewsAutomation');

function createViews(ctx, h, UI) {
  // Jedes Modul bekommt denselben Context — gibt einen Views-Map zurück
  const core       = createCoreViews(ctx, h, UI);
  const tools      = createToolViews(ctx, h, UI);
  const system     = createSystemViews(ctx, h, UI);
  const advanced   = createAdvancedViews(ctx, h, UI);
  const automation = createAutomationViews(ctx, h, UI);

  // Alle Views in einer flachen Map zusammenführen
  return Object.assign({}, core, tools, system, advanced, automation);
}

module.exports = { createViews: createViews };
