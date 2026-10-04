import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const engine = process.env.FNAA_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const profile = process.env.FNAA_MOBILE_PROFILE;
const options = profile === 'ios' ? devices['iPhone 13'] : profile === 'android' ? devices['Pixel 5'] : {};
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage(options);
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: fs.readFileSync(new URL('../../Fortnite-Ai-Agent-GitHub-Cloudflare/novasparx-renderer.js', import.meta.url), 'utf8') });
  const results = await page.evaluate(async () => {
    const results = [];
    for (const mode of ['model', 'image']) for (const suppliedNormals of [false, true]) {
      // Unreal's painted front is +Y. A distinct back prevents a camera turn
      // from concealing a missing left-handed to right-handed conversion.
      // The nonzero authored center also tests reflection after centering.
      const positions = new Float32Array([99,200.1,299, 101,200.1,299, 101,200.1,301, 99,200.1,301,
        99,199.9,299, 101,199.9,299, 101,199.9,301, 99,199.9,301]);
      const originalPositions = Array.from(positions);
      const manifest = {
        geometry: { positions, indices: new Uint32Array([0,1,2,0,2,3, 4,6,5,4,7,6]),
          uv0: new Float32Array([0,1,1,1,1,0,0,0, 0,1,1,1,1,0,0,0]) },
        sections: [{ firstIndex: 0, indexCount: 6, materialIndex: 0 }, { firstIndex: 6, indexCount: 6, materialIndex: 1 }],
        materials: [
          { roughness: 1, specular: 0, baseColorFrame: { width: 2, height: 2,
            pixels: new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255]).buffer } },
          { baseColor: [0.5,0,0.5,1], roughness: 1, specular: 0 }
        ]
      };
      if (suppliedNormals) manifest.geometry.normals = new Float32Array([0,1,0,0,1,0,0,1,0,0,1,0, 0,-1,0,0,-1,0,0,-1,0,0,-1,0]);
      const observed = {}, undo = [];
      for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
        const p = Type.prototype, names = new WeakMap(), buffers = new WeakMap(), attributes = new Map();
        const location = p.getUniformLocation, matrix = p.uniformMatrix4fv, bind = p.bindBuffer, data = p.bufferData;
        const attribute = p.getAttribLocation, pointer = p.vertexAttribPointer;
        let bound;
        p.getUniformLocation = function(program,name) { const x=location.call(this,program,name); if(x) names.set(x,name); return x; };
        p.uniformMatrix4fv = function(x,transpose,value) { const name=names.get(x); if(name==='uMVP'||name==='uModel') observed[name]=Array.from(value); return matrix.call(this,x,transpose,value); };
        p.bindBuffer = function(target,buffer) { if(target===this.ARRAY_BUFFER) bound=buffer; return bind.call(this,target,buffer); };
        p.bufferData = function(target,value,usage) { if(target===this.ARRAY_BUFFER&&bound) buffers.set(bound,Array.from(value)); return data.call(this,target,value,usage); };
        p.getAttribLocation = function(program,name) { const x=attribute.call(this,program,name); attributes.set(x,name); return x; };
        p.vertexAttribPointer = function(x,...args) { if(attributes.get(x)==='aNormal') observed.normal=buffers.get(bound); return pointer.call(this,x,...args); };
        undo.push(()=>{ p.getUniformLocation=location; p.uniformMatrix4fv=matrix; p.bindBuffer=bind; p.bufferData=data; p.getAttribLocation=attribute; p.vertexAttribPointer=pointer; });
      }
      const host=document.createElement('div'); host.style.cssText='width:320px;height:240px'; document.body.append(host);
      let controller, image;
      try {
        let width,height,sample;
        if(mode==='model') {
          controller=await window.NovaSparxRenderer.mount(manifest,host,{ground:false});
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const c=controller.canvas,gl=c.getContext('webgl2')||c.getContext('webgl'); width=c.width;height=c.height;
          sample=(x,y)=>{const pixel=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return Array.from(pixel);};
        } else {
          const result=await window.NovaSparxRenderer.render(manifest,{size:256});
          image=await createImageBitmap(result.blob);const c=document.createElement('canvas');c.width=width=result.width;c.height=height=result.height;
          const ctx=c.getContext('2d');ctx.drawImage(image,0,0);sample=(x,y)=>Array.from(ctx.getImageData(x,height-1-y,1,1).data);
        }
        const m=observed.uMVP,samples=[],screenX=[];
        for(const [x,z] of [[99.5,300.5],[100.5,300.5],[99.5,299.5],[100.5,299.5]]) {
          const y=200.1,w=m[3]*x+m[7]*y+m[11]*z+m[15];
          const px=Math.floor(((m[0]*x+m[4]*y+m[8]*z+m[12])/w+1)*width/2);
          const py=Math.floor(((m[1]*x+m[5]*y+m[9]*z+m[13])/w+1)*height/2);
          screenX.push(px);samples.push(sample(px,py));
        }
        const n=observed.normal,model=observed.uModel;
        const worldNormal=[model[0]*n[0]+model[4]*n[1]+model[8]*n[2],model[1]*n[0]+model[5]*n[1]+model[9]*n[2],model[2]*n[0]+model[6]*n[1]+model[10]*n[2]];
        results.push({mode,suppliedNormals,samples,rightIsRight:screenX[1]>screenX[0],worldNormal,buffersUnchanged:Array.from(positions).every((v,i)=>v===originalPositions[i])});
      } finally { controller?.dispose();image?.close();host.remove();undo.forEach(fn=>fn()); }
    }
    return results;
  });
  for(const {mode,suppliedNormals,samples:[red,green,blue,yellow],rightIsRight,worldNormal,buffersUnchanged} of results) {
    const label=`${mode}/${suppliedNormals?'native normals':'generated normals'}`;
    assert.ok(red[0]>red[1]*2&&red[0]>red[2]*2,label+': native painted front must be visible, not its back');
    assert.ok(green[1]>green[0]*2&&green[1]>green[2]*2,label+': front-right texel must stay right');
    assert.ok(blue[2]>blue[0]*2&&blue[2]>blue[1]*2,label+': front-bottom texel must stay below');
    assert.ok(yellow[0]>yellow[2]*2&&yellow[1]>yellow[2]*2,label+': native UVs must stay intact');
    assert.ok(rightIsRight,label+': geometry and writing must not be mirrored');
    assert.ok(worldNormal[1]<0&&Math.abs(worldNormal[0])+Math.abs(worldNormal[2])<1e-5,label+': normals must match converted triangle winding');
    assert.equal(buffersUnchanged,true,label+': viewer conversion must preserve shared native buffers');
  }
  console.log('Native Mesh handedness in View 3D and View Image: '+JSON.stringify(results));
} finally { await browser.close(); }
