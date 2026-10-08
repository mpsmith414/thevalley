import './valley.css';

// Placeholder until the valley itself is wired in: a sky-blue page and a way back to the lab.
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
canvas.width = innerWidth;
canvas.height = innerHeight;

const ui = document.querySelector<HTMLElement>('#ui')!;
const title = document.createElement('h1');
title.textContent = 'The Valley is coming 🌄';
const lab = document.createElement('a');
lab.href = '/lab.html';
lab.textContent = 'Creature Lab';
ui.append(title, lab);
