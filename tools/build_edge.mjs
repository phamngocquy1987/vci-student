import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({
 entryPoints:[path.join(root,'supabase/functions/vci-api/index.ts')],
 outfile:path.join(root,'deployment/vci-api.ts'),
 bundle:true,format:'esm',platform:'neutral',target:'es2022',
 external:['npm:*'],charset:'utf8',
 banner:{js:'// Generated from supabase/functions/vci-api. Paste this entire file into the Supabase Edge Function editor as index.ts.\n// This source contains no secret keys. Authentication and role checks remain enabled in the handler.'}
});
console.log('Prepared deployment/vci-api.ts for the Supabase Dashboard editor.');
