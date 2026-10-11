import { render } from 'preact';
import { App } from './ui/App';
import { ensureFonts } from './render/fonts';
import { assets } from './storage/assets';
import { refreshProjects } from './pipeline/actions';

ensureFonts(['Inter']);
void assets.ready.then(() => refreshProjects());
render(<App />, document.getElementById('root')!);
