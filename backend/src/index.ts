import { loadAndValidateEnv } from './config/env.js';
import { createApp } from './routes/app.js';

const config = loadAndValidateEnv();
const app = createApp({ llmConfigured: config.llm.configured });

app.listen(config.port, '0.0.0.0', () => {
  console.log(`🌹 DatingAgent backend running on http://0.0.0.0:${config.port}`);
  console.log(`   API:  http://0.0.0.0:${config.port}/api/health`);
  console.log(`   LLM:  ${config.llm.configured ? 'live' : 'mock mode'}`);
});
