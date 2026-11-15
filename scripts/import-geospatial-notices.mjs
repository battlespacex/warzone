import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseNotam,parseMaritimeWarning,normalizeNotice} from '../apps/shared/geospatial-notices.js';

// Offline administrative ingestion only. No URL fetching, scripts, OCR or runtime PDF parsing.
export async function extractDocument(file) {
    const bytes=await fs.readFile(file);if(bytes.length>10e6)throw Error('Document exceeds 10 MB limit');
    const ext=path.extname(file).toLowerCase();
    if(ext==='.pdf'){
        const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false});
        let result='';
        try{const pdf=await task.promise;if(pdf.numPages>100)throw Error('Document exceeds 100 page limit');
            for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();
                result+=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n';page.cleanup();if(result.length>500000)throw Error('Extracted text too large');}
        }finally{await task.destroy();}
        if(!result.trim())throw Error('No machine-readable text; verified manual transcription required');return result;
    }
    if(!['.txt','.html','.htm'].includes(ext))throw Error('Use a local text, HTML or machine-readable PDF document');
    const raw=bytes.toString('utf8');
    return ext==='.txt'?raw:raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/?(?:p|div|br|tr|li|h\d)\b[^>]*>/gi,'\n')
        .replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(+n,0x10ffff)));
}
export async function importDocument(input,context) {
    if(context.usageApproved!==true)throw Error('Explicit source usage approval required');
    const raw=await extractDocument(input),provenance={...context.provenance,extraction:'administrator-reviewed local document'};
    if(context.format==='notam')return parseNotam(raw,{...context,provenance});
    if(context.format==='maritime')return parseMaritimeWarning(raw,{...context,provenance});
    return normalizeNotice({...context,rawText:raw,provenance});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{const [input,contextFile,output]=process.argv.slice(2);if(!input||!contextFile||!output)throw Error('Usage: node scripts/import-geospatial-notices.mjs LOCAL_DOCUMENT REVIEWED_CONTEXT.json NEW_OUTPUT.json');
        const context=JSON.parse(await fs.readFile(contextFile,'utf8')),record=await importDocument(input,context);
        await fs.writeFile(output,JSON.stringify([record],null,2)+'\n',{flag:'wx'});console.log('Wrote one validated notice for administrator review; no network requests.');
    }catch(error){console.error(error.message);process.exitCode=1;}
}
