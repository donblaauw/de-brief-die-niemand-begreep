// Draait alle 27 gesprekken (3 keuzes × 3 rondes) door de spellogica in index.html.
// Gebruik: node test/routes.test.js   (geen dependencies)
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const code=html.match(/<script>([\s\S]*)<\/script>/)[1];

// Minimale DOM-stub: de test raakt alleen de logica, niet de weergave.
const stub=new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>'':stub,apply:()=>stub,set:()=>true});
const ctx=vm.createContext({document:stub,window:stub,localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:true})});
vm.runInContext(code+';globalThis.api={ROUNDS,fresh,advance,debrief,LETTERS,MOODS,sentences,hash}',ctx);
const {ROUNDS,fresh,advance,debrief,LETTERS,MOODS,sentences,hash}=ctx.api;
const root=path.join(__dirname,'..');
const audioFor=t=>sentences(t).map(x=>`assets/audio/noa-${hash(x)}.mp3`);
const missing=new Set(),clips=new Set();

const PROMISE=/u zei|vandaag (nog )?opgelost|vandaag toch oplossen|ervoor zou zorgen|eerst zei u/i;
const OVERSIGHT=/pagina 3|pagina 2 van 3|mist er|er mist|ontbreekt/i;
const EVALUATIVE=/\b(juiste|goede|goed|fout|foute|beter|slecht|verstandig|slim|aanrader|had je|zou je)\b/i;
const failures=[],titles=new Set(),r2said=new Set(),r3said=new Set(),r3noa=new Set();
let routes=0;

function check(cond,route,msg){if(!cond)failures.push(`${route}: ${msg}`)}

for(const a of [0,1,2])for(const b of [0,1,2])for(const c of [0,1,2]){
 const route=[a,b,c].map(i=>LETTERS[i]).join('');routes++;
 const s=fresh();
 [a,b,c].forEach((pick,turn)=>{
  const before={promises:s.promises,found:s.foundAt!==null,handedOff:s.handedOff,trust:s.trust};
  const said=ROUNDS[turn].said(s),mood=ROUNDS[turn].mood(s);
  check(mood in MOODS&&fs.existsSync(path.join(root,`assets/noa/${mood}.jpg`)),route,`ronde ${turn+1} beeld ontbreekt voor stemming ${mood}`);
  const out=advance(s,pick);
  const after={found:s.foundAt!==null};
  for(const [k,v] of Object.entries({said,cue:out.cue,noa:out.noa,note:out.note}))
   check(typeof v==='string'&&v.length>3&&!/undefined|NaN|\[object/.test(v),route,`ronde ${turn+1} ${k} ongeldig: ${v}`);
  // Geen oordeel direct na de keuze.
  check(!EVALUATIVE.test(out.note),route,`ronde ${turn+1} note oordeelt: ${out.note}`);
  check(!EVALUATIVE.test(out.cue),route,`ronde ${turn+1} cue oordeelt: ${out.cue}`);
  // Verwijzingen kloppen met wat er echt gebeurde.
  if(PROMISE.test(said)&&!/Echt\?|Mag ik/.test(said))check(before.promises>0,route,`ronde ${turn+1} said verwijst naar niet-gedane belofte: ${said}`);
  if(PROMISE.test(out.noa))check(before.promises>0,route,`ronde ${turn+1} noa verwijst naar niet-gedane belofte: ${out.noa}`);
  if(/Eerst zei u vandaag, nu morgen/.test(out.noa))check(before.promises>0&&pick===2&&turn===2,route,'tegenstrijdigheid zonder twee beloften');
  if(/vierde keer|andere team/.test(out.noa+said))check(s.handedOff,route,'doorverwijzing genoemd zonder doorverwijzing');
  if(OVERSIGHT.test(said))check(before.found,route,`ronde ${turn+1} said noemt ontbrekende pagina voor ontdekking: ${said}`);
  if(OVERSIGHT.test(out.noa))check(after.found,route,`ronde ${turn+1} noa noemt ontbrekende pagina zonder ontdekking: ${out.noa}`);
  if(after.found&&!before.found)check(OVERSIGHT.test(out.noa)&&OVERSIGHT.test(out.note),route,`ronde ${turn+1} ontdekking niet zichtbaar in reactie en notitie`);
  check(out.mood in MOODS&&fs.existsSync(path.join(root,`assets/noa/${out.mood}.jpg`)),route,`ronde ${turn+1} reactiebeeld ontbreekt: ${out.mood}`);
  check(out.photo===undefined||['full','cropped'].includes(out.photo),route,`ongeldige foto: ${out.photo}`);
  check((out.photo==='full')===(after.found&&!before.found),route,`foto 'full' hoort precies bij het moment van ontdekking (ronde ${turn+1})`);
  check(out.photo!=='cropped'||!after.found,route,'afgesneden foto terwijl de pagina al ontdekt is');
  for(const t of [said,out.noa])for(const f of audioFor(t)){clips.add(f);if(!fs.existsSync(path.join(root,f)))missing.add(`${f} <- ${t}`)}
  if(turn===1)r2said.add(said);
  if(turn===2){r3said.add(said);r3noa.add(out.noa)}
 });
 check(s.turn===3&&s.log.length===3,route,'gesprek eindigt niet na 3 rondes');
 const d=debrief(s);
 titles.add(d.title);
 for(const k of ['title','reflectHead','reflect','effect'])check(typeof d[k]==='string'&&d[k].length>10&&!/undefined|NaN|\[object/.test(d[k]),route,`nabespreking ${k} ongeldig: ${d[k]}`);
 const found=s.foundAt!==null;
 check(found===/vond het ontbrekende stuk|zag wat er ontbrak|zicht op de situatie/.test(d.title),route,`titel past niet bij ontdekking: ${d.title}`);
 check(found===(d.reflectHead==='Wat veranderde'),route,'reflectie past niet bij ontdekking');
 check(found===!d.warn,route,'waarschuwingsstijl past niet bij ontdekking');
 check(/beloof|belofte/.test(d.effect)===(s.promises>0),route,`beloften in nabespreking kloppen niet: ${d.effect}`);
 check(/door te verwijzen/.test(d.effect)===s.handedOff,route,'doorverwijzing in nabespreking klopt niet');
 check(/verwijt/.test(d.effect)===s.blamed,route,'verwijt in nabespreking klopt niet');
 check(/tegenstrijdigheid/.test(d.effect)===(s.promises>=2),route,'tegenstrijdigheid in nabespreking klopt niet');
 // Opnieuw starten: een verse toestand is volledig schoon.
 const again=fresh();
 check(again.turn===0&&again.trust===0&&again.promises===0&&again.foundAt===null&&!again.handedOff&&!again.blamed&&!again.picks.length&&!again.log.length,route,'verse toestand is niet schoon');
}

// Dekking: elke variant die we schreven moet bereikbaar zijn (de oude ronde-2-conditie was dat niet).
check(routes===27,'dekking',`verwacht 27 routes, kreeg ${routes}`);
check(r2said.size===3,'dekking',`ronde 2 heeft ${r2said.size} van 3 varianten bereikbaar`);
check([...r2said].some(t=>/Ik weet niet waarom ik dit aan u uitleg/.test(t)),'dekking','gesloten Noa-reactie in ronde 2 is onbereikbaar');
check(titles.size===6,'dekking',`${titles.size} van 6 nabesprekingstitels bereikbaar: ${[...titles].join(' | ')}`);

check(missing.size===0,'audio',`opnames ontbreken: ${[...missing].join(' | ')}`);
const orphans=fs.readdirSync(path.join(root,'assets/audio')).filter(f=>!clips.has(`assets/audio/${f}`));
check(orphans.length===0,'audio',`opnames zonder zin: ${orphans.join(', ')}`);

if(failures.length){console.error(`${failures.length} probleem(en):\n- `+failures.join('\n- '));process.exit(1)}
console.log(`OK: ${clips.size} opnames · ${routes} routes · ${titles.size} nabesprekingstitels · ${r2said.size} varianten ronde 2 · ${r3said.size} varianten ronde 3 (Noa) · ${r3noa.size} reacties ronde 3`);
