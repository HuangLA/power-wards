export const DEFAULT_TAGS = ['天辉进攻','天辉防守','夜魇进攻','夜魇防守','需要砍树','特定条件'];
export function parseTags(text) { return [...new Set(text.split(/[,，\n]/).map(t=>t.trim()).filter(Boolean))]; }
export function matches(ward, query, tags) { return tags.every(t=>ward.tags.includes(t)) && [ward.name,ward.description,...ward.tags].join(' ').toLowerCase().includes(query.toLowerCase().trim()); }
export function validateImport(data) {
  if (!data || data.format !== 'power-wards' || data.version !== 1 || data.map !== 'Game_map_7.41.jpg' || !Array.isArray(data.wards) || data.wards.length>5000) throw new Error('文件格式或地图版本不兼容');
  const ids = new Set();
  return data.wards.map(w=>{
    if (!w || typeof w.id!=='string' || !w.id || ids.has(w.id) || !Number.isFinite(w.x) || !Number.isFinite(w.y) || w.x<0 || w.x>1 || w.y<0 || w.y>1 || typeof w.name!=='string' || w.name.length>100 || typeof w.description!=='string' || w.description.length>20000 || !/^#[0-9a-f]{6}$/i.test(w.color) || !Array.isArray(w.tags) || w.tags.length>100 || w.tags.some(t=>typeof t!=='string'||t.length>1000) || !Array.isArray(w.photos) || w.photos.length>100) throw new Error('眼位数据不完整或超出限制');
    ids.add(w.id);
    const photos=w.photos.map(p=>{if(!p || typeof p.id!=='string' || typeof p.data!=='string' || p.data.length>17*1024*1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(p.data)) throw new Error('截图数据无效');return {id:p.id,data:p.data};});
    return {id:w.id,x:w.x,y:w.y,name:w.name,color:w.color,tags:[...new Set(w.tags)],description:w.description,photos};
  });
}
