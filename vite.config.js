import { defineConfig } from 'vite';
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import archive from './src/archive-info.json' with {type:'json'};
import release from './src/release-info.json' with {type:'json'};
let commit=/^[a-f0-9]{40}$/.test(archive.commit)?archive.commit:'development',committedAt=Number.isFinite(Date.parse(archive.committedAt))?archive.committedAt:null;
const sourceRoot=fileURLToPath(new URL('./',import.meta.url));
try{const git=args=>execFileSync('git',args,{cwd:sourceRoot,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();if(realpathSync(git(['rev-parse','--show-toplevel']))===realpathSync(sourceRoot)){commit=git(['rev-parse','HEAD']);committedAt=git(['show','-s','--format=%cI','HEAD']);}}catch{}
const info={...release,commit,committedAt,builtAt:new Date().toISOString()};
export default defineConfig({base:'./',define:{__BUILD_INFO__:JSON.stringify(info)},plugins:[{name:'public-build-version',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify(info)+'\n'});}}],build:{target:'es2022'},server:{host:'127.0.0.1',port:5173,strictPort:true}});
