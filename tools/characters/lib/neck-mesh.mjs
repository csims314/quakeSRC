import { apply, sub, dot, cross, normalize, lerp, centroid } from './math.mjs';

// A capped oval column. Its size is independent of the photograph and head
// scale. Each posed ring keeps an orthonormal basis, rather than flattening
// when two differently rotated skinning matrices are averaged.
export function createNeckMesh(spec, grid) {
  const slices = 24, levels = 8, vertices = [], triangles = [], rings = [];
  for (let row = 0; row < levels; row++) {
    const t = row / (levels - 1), ring = [];
    for (let i = 0; i <= slices; i++) {
      ring.push(vertices.length);
      vertices.push({ t, angle: i / slices * Math.PI * 2, side: 'neck',
        uv: [1 + i / slices * (grid.width - 18), 1 + (1 - t) * (grid.height - 2)] });
    }
    rings.push(ring);
  }
  for (let row = 0; row < levels - 1; row++) for (let i = 0; i < slices; i++) {
    const [a,b,c,d] = [rings[row][i],rings[row+1][i],rings[row+1][i+1],rings[row][i+1]];
    triangles.push([a,b,c],[a,c,d]); // clockwise outside: increasing angle, z up
  }
  for (const [row, top] of [[0,false],[levels-1,true]]) {
    const pole = vertices.length;
    vertices.push({t:top?1:0, pole:true, side:'neck',uv:[grid.width/2,top?1:grid.height-1]});
    for(let i=0;i<slices;i++) triangles.push(top?[rings[row][i+1],rings[row][i],pole]:[rings[row][i],rings[row][i+1],pole]);
  }
  const rotationX = motion => [motion.rotation[0], motion.rotation[3], motion.rotation[6]];
  const posed = (headMotion, collarMotion) => {
    const top=apply(headMotion,spec.top),bottom=apply(collarMotion,spec.bottom),axis=normalize(sub(top,bottom));
    return vertices.map(vertex => {
      const {t}=vertex,center=lerp(bottom,top,t);
      if(vertex.pole)return center;
      const direction=lerp(rotationX(collarMotion),rotationX(headMotion),t);
      let x=normalize(sub(direction,axis.map(v=>v*dot(direction,axis))));
      if(Math.hypot(...cross(x,axis))<0.1)x=normalize(cross([0,1,0],axis));
      const y=normalize(cross(axis,x)),radius=lerp([...spec.bottomRadius,0],[...spec.topRadius,0],t);
      return center.map((v,k)=>v+x[k]*Math.cos(vertex.angle)*radius[0]+y[k]*Math.sin(vertex.angle)*radius[1]);
    });
  };
  return {vertices,triangles,posed};
}

// Removing the original helmet also removes the roof of the torso. Seal its
// eight-edge opening with a charcoal collar insert, copying the rim positions
// from the original body in every frame. The neck overlaps this closed surface.
export function createCollarInsert(body, pose, removed, palette) {
  const key=p=>p.map(v=>v.toFixed(4)).join(','),edges=new Map();
  for(const triangle of body.triangles.filter(t=>t.v.every(i=>!removed.has(i))))for(let k=0;k<3;k++){
    const [a,b]=[triangle.v[k],triangle.v[(k+1)%3]],pair=[key(pose[a]),key(pose[b])].sort().join('/');
    if(!edges.has(pair))edges.set(pair,[]);edges.get(pair).push([a,b]);
  }
  const boundary=[...edges.values()].filter(e=>e.length===1).map(e=>e[0])
    .filter(([a,b])=>[a,b].every(i=>pose[i][2]>14&&pose[i][2]<21&&Math.hypot(pose[i][0],pose[i][1]+1.3)<5));
  if(boundary.length!==8)throw new Error(`Unexpected armor opening (${boundary.length} edges)`);
  let best=Infinity,uv;
  for(let i=0;i<body.skins[0].length;i++){
    const index=body.skins[0][i],rgb=palette.subarray(index*3,index*3+3);
    const distance=[48,44,40].reduce((sum,v,k)=>sum+(rgb[k]-v)**2,0);
    if(distance<best){best=distance;uv={onseam:0,s:i%body.skinWidth,t:Math.floor(i/body.skinWidth)};}
  }
  const vertices=[],triangles=[],lookup=new Map();
  const add=source=>{
    const k=key(pose[source]);if(lookup.has(k))return lookup.get(k);
    const id=vertices.length;lookup.set(k,id);vertices.push({source,bodyUv:uv});return id;
  };
  const rim=[...new Set(boundary.flatMap(([a,b])=>[add(a),add(b)]))];
  const center=vertices.length;vertices.push({bodyUv:uv});
  for(const [a,b]of boundary)triangles.push([add(b),add(a),center]);
  const posed=positions=>{
    const points=vertices.map(v=>v.source===undefined?null:positions[v.source]);
    points[center]=centroid(rim.map(i=>points[i]));return points;
  };
  return{vertices,triangles,posed};
}
