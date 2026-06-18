import { mount } from 'svelte';
import './GraleElement.svelte'; // side-effect: registers the <grale-view> custom element
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
