import { bootRenderer } from '@render/bootstrap';

const root = document.getElementById('game-root');
if (!root) {
  throw new Error('#game-root is missing from index.html');
}

await bootRenderer(root);
