import { defineConfig } from 'vite';
import {execFileSync} from 'node:child_process';
import release from './src/release-info.json' with {type:'json'};
let commit='development',committedAt=null;
try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();committedAt=execFileSync('git',['show','-s','--format=%cI','HEAD'],{encoding:'utf8',windowsHide:true}).trim();}catch{}
const info={...release,commit,committedAt,builtAt:new Date().toISOString()};
export default defineConfig({base:'./',define:{__BUILD_INFO__:JSON.stringify(info)},plugins:[{name:'public-build-version',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify(info)+'\n'});}}],build:{target:'es2022'},server:{host:'127.0.0.1',port:5173,strictPort:true}});
