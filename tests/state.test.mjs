import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,setPrinted,downloaded,sanitizeState,validateTiers} from '../src/state.js';
const c={kind:'drawer',w:'S',d:'3',h:'1F',roof:'none'};
test('print without download, undo, and independent module progress',()=>{const s=freshState(c),u=s.units[0];setPrinted(u,'m0010',1);assert.equal(u.progress.m0010.printed,1);assert.equal(u.progress.m0010.downloadedAt,undefined);setPrinted(u,'m0010',0);downloaded(u,'m0010');assert.equal(u.progress.m0010.printed,0);assert.ok(u.progress.m0010.downloadedAt);assert.deepEqual(freshState(c).units[0].progress,{});});
test('restore excludes injected paths and file payloads',()=>{const s=freshState(c);s.files=['private.stl'];const r=sanitizeState(s,new Set());assert.equal(r.files,undefined);assert.equal(r.units[0].config.w,'S');});
test('restore rejects markup identifiers before rendering',()=>{const s=freshState(c);s.units[0].id='"><img src=x onerror=alert(1)>';assert.throws(()=>sanitizeState(s,new Set()),/配置/);const t=freshState(c);t.plans=[{id:'<script>',tiers:[]}];assert.throws(()=>sanitizeState(t,new Set()),/标识/);});
test('plan requires equal widths/depth, unique instances and clear roofs',()=>{const units=[{id:'a',config:c},{id:'b',config:{...c}},{id:'l',config:{...c,w:'L'}}];assert.equal(validateTiers([{pattern:'single',ids:['l']},{pattern:'SS',ids:['a','b']}],units),'');assert.match(validateTiers([{pattern:'single',ids:['a']},{pattern:'single',ids:['l']}],units),/同宽/);assert.match(validateTiers([{pattern:'SS',ids:['a','a']}],units),/重复/);});
