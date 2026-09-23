await Promise.all(['Regular','Medium','Bold'].map(style=>figma.loadFontAsync({family:'Noto Sans SC',style})));
const vv=await figma.variables.getLocalVariablesAsync(); const V=Object.fromEntries(vv.map(v=>[v.name,v])); const SS=await figma.getLocalTextStylesAsync();const TS=Object.fromEntries(SS.map(s=>[s.name,s]));const ids=[];
const track=n=>{ids.push(n.id);return n;};
const fill=name=>[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',V['color/'+name])];
function radius(n,key='control'){for(const prop of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'])n.setBoundVariable(prop,V['radius/'+key]);}
function layout(parent,name,w,h,dir='VERTICAL',bg='panel',pad=0,gap=0){const n=track(figma.createAutoLayout(dir));parent.appendChild(n);n.name=name;n.resize(w,h);n.primaryAxisSizingMode='FIXED';n.counterAxisSizingMode='FIXED';n.fills=bg?fill(bg):[];for(const k of ['paddingLeft','paddingRight','paddingTop','paddingBottom'])n.setBoundVariable(k,V['space/'+pad]);n.setBoundVariable('itemSpacing',V['space/'+gap]);return n;}
async function txt(parent,name,value,width=240,style='Body',color='text'){const n=track(figma.createText());parent.appendChild(n);n.name=name;n.fontName={family:'Noto Sans SC',style:'Regular'};await n.setTextStyleIdAsync(TS['PW/'+style].id);n.textAutoResize='HEIGHT';n.resize(width,24);n.characters=value;n.fills=fill(color);return n;}
function box(parent,name,w,h,bg='background'){const n=track(figma.createFrame());parent.appendChild(n);n.name=name;n.resize(w,h);n.fills=bg?fill(bg):[];n.clipsContent=true;return n;}
function allIds(n){return [n.id,...('children'in n?n.children.flatMap(allIds):[])];}

