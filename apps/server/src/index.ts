import { createApp, findIndexHtml } from './app.js';

const PORT = process.env.PORT || 3000;
const app = createApp();
const indexHtml = findIndexHtml();

app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
  console.log(indexHtml ? `UI: ${indexHtml}` : 'UI: no index.html (GET / will 404 until web/public or web/dist exists)');
});
