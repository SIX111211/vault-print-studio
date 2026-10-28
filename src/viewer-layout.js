// Deterministic screen-plane spacing for exploded previews. Geometry is never
// scaled; the returned translations only separate the displayed instances.
export function separateRectangles(rectangles, gap = 10) {
  const placed = [], result = new Map();
  const ordered = rectangles.map((r, index) => ({...r, index})).sort((a,b) => b.width*b.height-a.width*a.height || a.index-b.index);
  const overlaps = (r, q) => Math.abs(r.x-q.x) < (r.width+q.width)/2+gap && Math.abs(r.y-q.y) < (r.height+q.height)/2+gap;
  for (const rect of ordered) {
    if (![rect.x,rect.y,rect.width,rect.height,gap].every(Number.isFinite) || rect.width<0 || rect.height<0 || gap<0) throw TypeError('Invalid preview bounds');
    if(!placed.some(q=>overlaps(rect,q))){placed.push({...rect});result.set(rect.key,{x:0,y:0});continue;}
    const candidates=[];
    const add=(x,y)=>candidates.push({x,y,cost:(x-rect.x)**2+(y-rect.y)**2});
    add(rect.x,rect.y);
    const neighbors=placed.length>24?placed.slice().sort((a,b)=>(a.x-rect.x)**2+(a.y-rect.y)**2-((b.x-rect.x)**2+(b.y-rect.y)**2)).slice(0,24):placed;
    for(const q of neighbors){
      const xs=[q.x-(q.width+rect.width)/2-gap,q.x+(q.width+rect.width)/2+gap];
      const ys=[q.y-(q.height+rect.height)/2-gap,q.y+(q.height+rect.height)/2+gap];
      for(const x of xs){add(x,rect.y);add(x,q.y);for(const y of ys)add(x,y);}
      for(const y of ys){add(rect.x,y);add(q.x,y);}
    }
    add(rect.x,Math.max(...placed.map(q=>q.y+q.height/2))+rect.height/2+gap);
    add(rect.x,Math.min(...placed.map(q=>q.y-q.height/2))-rect.height/2-gap);
    add(Math.max(...placed.map(q=>q.x+q.width/2))+rect.width/2+gap,rect.y);
    add(Math.min(...placed.map(q=>q.x-q.width/2))-rect.width/2-gap,rect.y);
    candidates.sort((a,b)=>a.cost-b.cost||a.y-b.y||a.x-b.x);
    const point=candidates.find(p=>!placed.some(q=>overlaps({...rect,...p},q))) || {x:Math.max(0,...placed.map(q=>q.x+q.width/2))+rect.width/2+gap,y:rect.y};
    placed.push({...rect,x:point.x,y:point.y});result.set(rect.key,{x:point.x-rect.x,y:point.y-rect.y});
  }
  return result;
}

export const easeInOut = t => {t=Math.max(0,Math.min(1,t));return t<.5?4*t*t*t:1-(-2*t+2)**3/2;};
