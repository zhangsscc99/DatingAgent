import { createApp } from './routes/app.js';

const PORT = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌹 DatingAgent backend running on http://0.0.0.0:${PORT}`);
  console.log(`   API:  http://0.0.0.0:${PORT}/api/health`);
  console.log(`   LLM:  ${process.env.OPENAI_API_KEY ? 'configured' : 'mock mode (set OPENAI_API_KEY)'}`);
});
