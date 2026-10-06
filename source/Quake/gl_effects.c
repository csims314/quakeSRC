/* Planar reflections and depth-aware volumetric scattering.
 * SPDX-License-Identifier: GPL-2.0-or-later */
#include "quakedef.h"
#include "render_effects_math.h"
#include <float.h>
#define FX_VectorSet(v,x,y,z) do {(v)[0]=(x);(v)[1]=(y);(v)[2]=(z);} while(0)

static int FX_Finite(float value){return value>=-FLT_MAX&&value<=FLT_MAX;}

cvar_t r_mirrors = {"r_mirrors", "1", CVAR_ARCHIVE};
cvar_t r_mirror_maxsize = {"r_mirror_maxsize", "2048", CVAR_ARCHIVE};
cvar_t r_vfog_quality = {"r_vfog_quality", "2", CVAR_ARCHIVE};
cvar_t r_vfog_density = {"r_vfog_density", "-1", CVAR_ARCHIVE};
extern cvar_t r_vfog, r_stereo;
extern float r_fovx, r_fovy;
extern void R_SetupGL(void), R_SetFrustum(float,float), R_RenderScene(void);

qboolean r_reflectionpass;
int r_viewstamp;

static PFNGLGENFRAMEBUFFERSEXTPROC fx_genfb;
static PFNGLDELETEFRAMEBUFFERSEXTPROC fx_deletefb;
static PFNGLBINDFRAMEBUFFEREXTPROC fx_bindfb;
static PFNGLFRAMEBUFFERTEXTURE2DEXTPROC fx_attachtex;
static PFNGLCHECKFRAMEBUFFERSTATUSEXTPROC fx_checkfb;
static PFNGLGENRENDERBUFFERSEXTPROC fx_genrb;
static PFNGLDELETERENDERBUFFERSEXTPROC fx_deleterb;
static PFNGLBINDRENDERBUFFEREXTPROC fx_bindrb;
static PFNGLRENDERBUFFERSTORAGEEXTPROC fx_storagerb;
static PFNGLFRAMEBUFFERRENDERBUFFEREXTPROC fx_attachrb;
static qboolean fx_api_checked, fx_api, fx_depthapi, fx_failed, fx_warned;

typedef struct { GLuint fb, color, depth, depthrb, stencil; int w,h; } fx_target_t;
static fx_target_t fx_main, fx_mirror, fx_fog;
static fx_target_t *fx_current;
static GLint fx_destination;
static int fx_mainx,fx_mainy,fx_mainw,fx_mainh;
static GLuint fx_copyprogram,fx_mirrorprogram,fx_marchprogram,fx_upsampleprogram;
static float fx_reflectview[16],fx_reflectproj[16],fx_reflectvp[16];
static qboolean fx_mirror_map,fx_mirror_ready,fx_fog_map,fx_fog_explicit;
static int fx_mirrorpasses,fx_fogpasses,fx_fogsteps,fx_gridlights;
static float fx_fogdensity,fx_fogcolor[3],fx_height;
static vec3_t fx_min,fx_max;
static byte *fx_vis;
static GLuint fx_grid;
static int fx_nx,fx_ny,fx_nz,fx_aw,fx_ah,fx_cols;
static byte *fx_griddata;
/* Low mirror on the north-facing wall immediately behind the start spawn. */
static vec3_t fx_mirrormins={472,192,0},fx_mirrormaxs={616,194,88};
static const float fx_mirrororigin[3]={544,192.5f,0};
static const float fx_horizontal[3]={1,0,0};
static const float fx_normal[3]={0,1,0};
static const float fx_mirrordist=192.5f;

static void FX_MirrorPoint(vec3_t point,float offset,float horizontal,float height)
{
    int i;
    for(i=0;i<3;i++)point[i]=fx_mirrororigin[i]+fx_normal[i]*offset+fx_horizontal[i]*horizontal;
    point[2]+=height;
}

static qboolean FX_MirrorSupported(void)
{
    /* A BSP can split a continuous wall into multiple coplanar faces. */
    int x,z,i,j;vec3_t point;
    for(z=0;z<3;z++)for(x=0;x<3;x++) {
        qboolean supported=false;
        FX_MirrorPoint(point,-.5f,(x-1)*72,z*44);
        for(i=0;i<cl.worldmodel->nummodelsurfaces;i++) {
            msurface_t *surface=&cl.worldmodel->surfaces[cl.worldmodel->firstmodelsurface+i];
            float facing=DotProduct(surface->plane->normal,fx_normal)*(surface->flags&SURF_PLANEBACK?-1:1);
            if(facing<.999f)continue;
            for(j=0;j<3;j++)if(point[j]<surface->mins[j]-.1f||point[j]>surface->maxs[j]+.1f)break;
            if(j==3){supported=true;break;}
        }
        if(!supported)return false;
    }
    return true;
}

static void FX_Warn(const char *message)
{
    if(!fx_warned) Con_Warning("Render effects: %s; using the original renderer.\n",message);
    fx_warned=true;
}

static void *FX_Proc(const char *name,const char *ext)
{
    void *p=GL_GetProcAddress(name); return p?p:GL_GetProcAddress(ext);
}

static qboolean FX_API(void)
{
    if(fx_api_checked) return fx_api;
    fx_api_checked=true;
    if(!gl_glsl_able) return false;
    {const char *extensions=(const char *)glGetString(GL_EXTENSIONS);
    fx_depthapi=extensions&&(strstr(extensions,"GL_ARB_depth_texture")||strstr(extensions,"GL_OES_depth_texture"));}
    fx_genfb=(PFNGLGENFRAMEBUFFERSEXTPROC)FX_Proc("glGenFramebuffers","glGenFramebuffersEXT");
    fx_deletefb=(PFNGLDELETEFRAMEBUFFERSEXTPROC)FX_Proc("glDeleteFramebuffers","glDeleteFramebuffersEXT");
    fx_bindfb=(PFNGLBINDFRAMEBUFFEREXTPROC)FX_Proc("glBindFramebuffer","glBindFramebufferEXT");
    fx_attachtex=(PFNGLFRAMEBUFFERTEXTURE2DEXTPROC)FX_Proc("glFramebufferTexture2D","glFramebufferTexture2DEXT");
    fx_checkfb=(PFNGLCHECKFRAMEBUFFERSTATUSEXTPROC)FX_Proc("glCheckFramebufferStatus","glCheckFramebufferStatusEXT");
    fx_genrb=(PFNGLGENRENDERBUFFERSEXTPROC)FX_Proc("glGenRenderbuffers","glGenRenderbuffersEXT");
    fx_deleterb=(PFNGLDELETERENDERBUFFERSEXTPROC)FX_Proc("glDeleteRenderbuffers","glDeleteRenderbuffersEXT");
    fx_bindrb=(PFNGLBINDRENDERBUFFEREXTPROC)FX_Proc("glBindRenderbuffer","glBindRenderbufferEXT");
    fx_storagerb=(PFNGLRENDERBUFFERSTORAGEEXTPROC)FX_Proc("glRenderbufferStorage","glRenderbufferStorageEXT");
    fx_attachrb=(PFNGLFRAMEBUFFERRENDERBUFFEREXTPROC)FX_Proc("glFramebufferRenderbuffer","glFramebufferRenderbufferEXT");
    fx_api=fx_genfb&&fx_deletefb&&fx_bindfb&&fx_attachtex&&fx_checkfb&&fx_genrb&&fx_deleterb&&fx_bindrb&&fx_storagerb&&fx_attachrb;
    if(!fx_api) FX_Warn("framebuffer objects unavailable");
    return fx_api;
}

static void FX_DeleteTarget(fx_target_t *t)
{
    if(t->fb&&fx_deletefb) fx_deletefb(1,&t->fb);
    if(t->depthrb&&fx_deleterb) fx_deleterb(1,&t->depthrb);
    if(t->stencil&&fx_deleterb) fx_deleterb(1,&t->stencil);
    glDeleteTextures(1,&t->color); glDeleteTextures(1,&t->depth);
    memset(t,0,sizeof(*t));
}

static void FX_Texture(GLuint *id,int w,int h,qboolean depth)
{
    glGenTextures(1,id); glBindTexture(GL_TEXTURE_2D,*id);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,depth?GL_NEAREST:GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,depth?GL_NEAREST:GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D,0,depth?GL_DEPTH_COMPONENT:GL_RGBA,w,h,0,
        depth?GL_DEPTH_COMPONENT:GL_RGBA,depth?GL_UNSIGNED_SHORT:GL_UNSIGNED_BYTE,NULL);
}

static qboolean FX_Target(fx_target_t *t,int w,int h,qboolean scene)
{
    GLint oldfb,oldrb; GLenum status;
    if(t->fb&&t->w==w&&t->h==h) return true;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING_EXT,&oldfb); glGetIntegerv(GL_RENDERBUFFER_BINDING_EXT,&oldrb);
    FX_DeleteTarget(t); t->w=w;t->h=h;
    GL_DisableMultitexture();
    fx_genfb(1,&t->fb);fx_bindfb(GL_FRAMEBUFFER_EXT,t->fb);
    FX_Texture(&t->color,w,h,false);
    fx_attachtex(GL_FRAMEBUFFER_EXT,GL_COLOR_ATTACHMENT0_EXT,GL_TEXTURE_2D,t->color,0);
    if(scene) {
        if(fx_depthapi) {
            FX_Texture(&t->depth,w,h,true);
            fx_attachtex(GL_FRAMEBUFFER_EXT,GL_DEPTH_ATTACHMENT_EXT,GL_TEXTURE_2D,t->depth,0);
        }
        if(!fx_depthapi||fx_checkfb(GL_FRAMEBUFFER_EXT)!=GL_FRAMEBUFFER_COMPLETE_EXT) {
            fx_attachtex(GL_FRAMEBUFFER_EXT,GL_DEPTH_ATTACHMENT_EXT,GL_TEXTURE_2D,0,0);
            glDeleteTextures(1,&t->depth);t->depth=0;
            fx_genrb(1,&t->depthrb);fx_bindrb(GL_RENDERBUFFER_EXT,t->depthrb);
            fx_storagerb(GL_RENDERBUFFER_EXT,GL_DEPTH_COMPONENT16,w,h);
            fx_attachrb(GL_FRAMEBUFFER_EXT,GL_DEPTH_ATTACHMENT_EXT,GL_RENDERBUFFER_EXT,t->depthrb);
        }
        fx_genrb(1,&t->stencil);fx_bindrb(GL_RENDERBUFFER_EXT,t->stencil);
        fx_storagerb(GL_RENDERBUFFER_EXT,GL_STENCIL_INDEX8_EXT,w,h);
        fx_attachrb(GL_FRAMEBUFFER_EXT,GL_STENCIL_ATTACHMENT_EXT,GL_RENDERBUFFER_EXT,t->stencil);
        if(fx_checkfb(GL_FRAMEBUFFER_EXT)!=GL_FRAMEBUFFER_COMPLETE_EXT) {
            fx_attachrb(GL_FRAMEBUFFER_EXT,GL_STENCIL_ATTACHMENT_EXT,GL_RENDERBUFFER_EXT,0);
            fx_deleterb(1,&t->stencil);t->stencil=0;
        }
    }
    status=fx_checkfb(GL_FRAMEBUFFER_EXT);
    fx_bindfb(GL_FRAMEBUFFER_EXT,oldfb);fx_bindrb(GL_RENDERBUFFER_EXT,oldrb);
    GL_ClearBindings();
    if(status!=GL_FRAMEBUFFER_COMPLETE_EXT) {FX_DeleteTarget(t);fx_failed=true;FX_Warn("incomplete framebuffer");return false;}
    return true;
}

static const char *fx_screenvertex=
    "#version 110\n"
    "varying vec2 UV;void main(){gl_Position=vec4(gl_Vertex.xy,0.,1.);UV=gl_MultiTexCoord0.xy;}\n";
static const char *fx_copyfragment=
    "#version 110\n"
    "uniform sampler2D Image;varying vec2 UV;void main(){gl_FragColor=texture2D(Image,UV);}\n";
static const char *fx_mirrorvertex=
    "#version 110\n"
    "uniform vec4 Reflection0,Reflection1,Reflection2,Reflection3;varying vec4 Reflected;"
    "void main(){gl_Position=gl_ModelViewProjectionMatrix*gl_Vertex;"
    "Reflected=vec4(dot(Reflection0,gl_Vertex),dot(Reflection1,gl_Vertex),dot(Reflection2,gl_Vertex),dot(Reflection3,gl_Vertex));}\n";
static const char *fx_mirrorfragment=
    "#version 110\n"
    "uniform sampler2D Image;varying vec4 Reflected;void main(){"
    "vec2 uv=Reflected.xy/Reflected.w*.5+.5;gl_FragColor=vec4(texture2D(Image,clamp(uv,vec2(0.),vec2(1.))).rgb,1.);}\n";

/* One smooth, shadowed lighting field. Atlas tiles include a one-voxel border
 * so hardware bilinear filtering never bleeds into an adjacent z slice. */
static const char *fx_marchfragment=
    "#version 110\n"
    "varying vec2 UV;uniform sampler2D Depth,Grid;"
    "uniform vec4 Inverse0,Inverse1,Inverse2,Inverse3;"
    "uniform vec3 Camera,BoundsMin,BoundsMax,GridSize,FogColor;"
    "uniform vec4 Atlas,ClipPlane;uniform float Density,Steps;"
    "vec3 world(vec2 uv,float d){vec4 p=vec4(uv*2.-1.,d*2.-1.,1.);"
    "vec4 w=vec4(dot(Inverse0,p),dot(Inverse1,p),dot(Inverse2,p),dot(Inverse3,p));return w.xyz/w.w;}"
    "vec4 slice(vec2 xy,float z){vec2 tile=vec2(mod(z,Atlas.z),floor(z/Atlas.z));"
    "return texture2D(Grid,(tile*(GridSize.xy+2.)+xy+1.5)/Atlas.xy);}"
    "vec4 field(vec3 p){vec3 g=clamp((p-BoundsMin)/(BoundsMax-BoundsMin),0.,1.)*(GridSize-1.);"
    "return mix(slice(g.xy,floor(g.z)),slice(g.xy,min(floor(g.z)+1.,GridSize.z-1.)),fract(g.z));}"
    "void main(){vec3 endpoint=world(UV,texture2D(Depth,UV).r);vec3 delta=endpoint-Camera;"
    "float lengthRay=length(delta);vec3 ray=delta/max(lengthRay,.001);"
    "vec3 safeRay=sign(ray)*max(abs(ray),vec3(.00001));safeRay+=vec3(equal(ray,vec3(0.)))*.00001;"
    "vec3 a=(BoundsMin-Camera)/safeRay,b=(BoundsMax-Camera)/safeRay;"
    "vec3 lo=min(a,b),hi=max(a,b);float start=max(0.,max(lo.x,max(lo.y,lo.z)));"
    "float end=min(lengthRay,min(hi.x,min(hi.y,hi.z)));"
    "if(dot(ClipPlane.xyz,ClipPlane.xyz)>.5){float denom=dot(ClipPlane.xyz,ray);"
    "if(denom>0.)start=max(start,-(dot(ClipPlane.xyz,Camera)+ClipPlane.w)/denom);}"
    "if(end<=start){gl_FragColor=vec4(0.,0.,0.,1.);return;}"
    "float stepSize=(end-start)/Steps;"
    "float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));"
    "float trans=1.;vec3 scatter=vec3(0.);"
    "for(int i=0;i<64;i++){if(float(i)>=Steps)break;"
    "vec3 p=Camera+ray*(start+(float(i)+jitter)*stepSize);vec4 volume=field(p);"
    "float attenuation=exp(-Density*volume.a*stepSize);"
    "scatter+=trans*(1.-attenuation)*FogColor*(vec3(.22)+volume.rgb*2.2);"
    "trans*=attenuation;if(trans<.005)break;}gl_FragColor=vec4(scatter,trans);}\n";

static const char *fx_upsamplefragment=
    "#version 110\n"
    "varying vec2 UV;uniform sampler2D Image,Depth;uniform vec3 Camera;uniform vec4 Size;"
    "uniform vec4 Inverse0,Inverse1,Inverse2,Inverse3;"
    "float distanceAt(vec2 uv){vec4 p=vec4(uv*2.-1.,texture2D(Depth,uv).r*2.-1.,1.);"
    "vec4 w=vec4(dot(Inverse0,p),dot(Inverse1,p),dot(Inverse2,p),dot(Inverse3,p));"
    "return length(w.xyz/w.w-Camera);}"
    "void main(){float center=distanceAt(UV);vec2 base=floor(UV*Size.xy-.5);"
    "vec4 total=vec4(0.);float sum=0.;"
    "for(int y=0;y<2;y++)for(int x=0;x<2;x++){"
    "vec2 uv=clamp((base+vec2(float(x),float(y))+.5)/Size.xy,Size.zw,vec2(1.)-Size.zw);"
    "vec2 diff=abs((uv-UV)*Size.xy);float spatial=max(.001,(1.-diff.x)*(1.-diff.y));"
    "float weight=spatial*exp(-abs(distanceAt(uv)-center)/max(2.,center*.015));"
    "total+=texture2D(Image,uv)*weight;sum+=weight;}"
    "gl_FragColor=sum>.00001?total/sum:vec4(0.,0.,0.,1.);}\n";

static void FX_UniformMatrix(GLuint p,const char *prefix,const float m[16])
{
    char name[64]; int i; for(i=0;i<4;i++) {
        q_snprintf(name,sizeof(name),"%s%d",prefix,i);
        GL_Uniform4fFunc(GL_GetUniformLocationFunc(p,name),m[i],m[4+i],m[8+i],m[12+i]);
    }
}

static void FX_Uniform3(GLuint p,const char *name,const float v[3])
{
    GL_Uniform3fFunc(GL_GetUniformLocationFunc(p,name),v[0],v[1],v[2]);
}

static void FX_Screen(void)
{
    glDisable(GL_ALPHA_TEST);glDisable(GL_DEPTH_TEST);glDisable(GL_CULL_FACE);glDisable(GL_FOG);
    glDepthMask(GL_FALSE);
    glBegin(GL_QUADS);
    glTexCoord2f(0,0);glVertex2f(-1,-1);glTexCoord2f(1,0);glVertex2f(1,-1);
    glTexCoord2f(1,1);glVertex2f(1,1);glTexCoord2f(0,1);glVertex2f(-1,1);
    glEnd();glDepthMask(GL_TRUE);
}

static qboolean FX_Programs(void)
{
    if(fx_failed) return false;
    if(!fx_copyprogram) fx_copyprogram=GL_CreateProgram(fx_screenvertex,fx_copyfragment,0,NULL);
    if(!fx_mirrorprogram) fx_mirrorprogram=GL_CreateProgram(fx_mirrorvertex,fx_mirrorfragment,0,NULL);
    if(!fx_marchprogram) fx_marchprogram=GL_CreateProgram(fx_screenvertex,fx_marchfragment,0,NULL);
    if(!fx_upsampleprogram) fx_upsampleprogram=GL_CreateProgram(fx_screenvertex,fx_upsamplefragment,0,NULL);
    if(!fx_copyprogram||!fx_mirrorprogram||!fx_marchprogram||!fx_upsampleprogram) {
        fx_failed=true;FX_Warn("effect shader compilation failed");return false;
    }
    return true;
}

typedef struct {vec3_t origin,color;float radius;} fx_light_t;
static fx_light_t fx_lights[128];
static int fx_numlights;

static void FX_ParseMap(void)
{
    const char *data=cl.worldmodel->entities; char key[128],value[4096],classname[128];
    vec3_t origin,color;float radius;int entity=0; qboolean haveorigin;
    fx_numlights=0;
    while((data=COM_Parse(data))&&com_token[0]=='{') {
        classname[0]=0;FX_VectorSet(origin,0,0,0);FX_VectorSet(color,1,1,1);radius=300;haveorigin=false;
        while((data=COM_Parse(data))&&com_token[0]!='}') {
            q_strlcpy(key,com_token[0]=='_'?com_token+1:com_token,sizeof(key));
            data=COM_ParseEx(data,CPE_ALLOWTRUNC);if(!data)break;
            q_strlcpy(value,com_token,sizeof(value));
            if(!strcmp(key,"classname")) q_strlcpy(classname,value,sizeof(classname));
            else if(!strcmp(key,"origin")) haveorigin=sscanf(value,"%f %f %f",&origin[0],&origin[1],&origin[2])==3;
            else if(!strcmp(key,"light")) radius=Q_atof(value);
            else if(!strcmp(key,"color")) sscanf(value,"%f %f %f",&color[0],&color[1],&color[2]);
            else if(entity==0&&!strcmp(key,"volfog")) {
                if(sscanf(value,"%f %f %f %f",&fx_fogdensity,&fx_fogcolor[0],&fx_fogcolor[1],&fx_fogcolor[2])==4)fx_fog_explicit=true;
            } else if(entity==0&&!strcmp(key,"volfog_bounds"))
                sscanf(value,"%f %f %f %f %f %f",&fx_min[0],&fx_min[1],&fx_min[2],&fx_max[0],&fx_max[1],&fx_max[2]);
            else if(entity==0&&!strcmp(key,"volfog_height"))fx_height=Q_atof(value);
        }
        entity++;
        if(haveorigin&&!strncmp(classname,"light",5)&&fx_numlights<Q_COUNTOF(fx_lights)) {
            fx_light_t *light=&fx_lights[fx_numlights++];
            VectorCopy(origin,light->origin);VectorCopy(color,light->color);
            light->radius=CLAMP(1,radius,2000);
            if(strstr(classname,"torch")||strstr(classname,"flame")) {
                light->color[1]*=.57f;light->color[2]*=.23f;
                light->origin[2]+=16;
            }
        }
    }
}

static qboolean FX_LightVisible(vec3_t from,vec3_t to)
{
    trace_t trace;hull_t *hull=&cl.worldmodel->hulls[0];
    memset(&trace,0,sizeof(trace));trace.fraction=1;trace.allsolid=true;
    SV_RecursiveHullCheck(hull,hull->firstclipnode,0,1,from,to,&trace);
    return !trace.startsolid&&!trace.allsolid&&trace.fraction>=.999f;
}

static float FX_Noise(vec3_t p)
{
    /* Smooth world-space density; evaluated once when baking the atlas. */
    return .72f+.17f*sinf(p[0]*.018f+sinf(p[1]*.013f))+.11f*sinf(p[1]*.026f+p[2]*.019f);
}

static void FX_BuildGrid(void)
{
    int x,y,z,i,c,tx,ty;vec3_t p,delta;float lighting[3],dist,density,edge;
    if(!fx_fog_map||fx_griddata) return;
    fx_nx=CLAMP(4,(int)ceilf((fx_max[0]-fx_min[0])/32)+1,40);
    fx_ny=CLAMP(4,(int)ceilf((fx_max[1]-fx_min[1])/32)+1,40);
    fx_nz=CLAMP(4,(int)ceilf((fx_max[2]-fx_min[2])/32)+1,20);
    fx_cols=(int)ceilf(sqrtf(fx_nz));fx_aw=(fx_nx+2)*fx_cols;
    fx_ah=(fx_ny+2)*((fx_nz+fx_cols-1)/fx_cols);
    fx_griddata=(byte *)calloc(fx_aw*fx_ah,4);
    if(!fx_griddata){FX_Warn("lighting atlas allocation failed");return;}
    for(z=0;z<fx_nz;z++)for(y=0;y<fx_ny;y++)for(x=0;x<fx_nx;x++) {
        p[0]=fx_min[0]+(fx_max[0]-fx_min[0])*x/(fx_nx-1);
        p[1]=fx_min[1]+(fx_max[1]-fx_min[1])*y/(fx_ny-1);
        p[2]=fx_min[2]+(fx_max[2]-fx_min[2])*z/(fx_nz-1);
        FX_VectorSet(lighting,0,0,0);density=0;
        if(Mod_PointInLeaf(p,cl.worldmodel)->contents!=CONTENTS_SOLID) {
            density=expf(-(p[2]-fx_min[2])/q_max(16,fx_height))*FX_Noise(p);
            edge=q_min(q_min(x,fx_nx-1-x),q_min(y,fx_ny-1-y));density*=CLAMP(0,edge,1);
            for(i=0;i<fx_numlights;i++) {
                fx_light_t *light=&fx_lights[i];
                VectorSubtract(p,light->origin,delta);dist=VectorLength(delta);
                if(dist>=light->radius*1.5f)continue;
                if(!FX_LightVisible(p,light->origin))continue;
                for(c=0;c<3;c++) lighting[c]+=light->color[c]*powf(q_max(0,1-dist/(light->radius*1.5f)),2)*.55f;
            }
        }
        tx=(z%fx_cols)*(fx_nx+2)+x+1;ty=(z/fx_cols)*(fx_ny+2)+y+1;
        for(c=0;c<3;c++)fx_griddata[(ty*fx_aw+tx)*4+c]=(byte)CLAMP(0,lighting[c]*255,255);
        fx_griddata[(ty*fx_aw+tx)*4+3]=(byte)CLAMP(0,density*255,255);
    }
    /* Duplicate the boundary voxels into each tile's padding. */
    for(z=0;z<fx_nz;z++)for(y=-1;y<=fx_ny;y++)for(x=-1;x<=fx_nx;x++) {
        int sx=CLAMP(0,x,fx_nx-1),sy=CLAMP(0,y,fx_ny-1);
        tx=(z%fx_cols)*(fx_nx+2);ty=(z/fx_cols)*(fx_ny+2);
        memcpy(fx_griddata+((ty+y+1)*fx_aw+tx+x+1)*4,fx_griddata+((ty+sy+1)*fx_aw+tx+sx+1)*4,4);
    }
    fx_gridlights=fx_numlights;
}

static void FX_UploadGrid(void)
{
    if(fx_grid||!fx_griddata)return;
    glGenTextures(1,&fx_grid);glBindTexture(GL_TEXTURE_2D,fx_grid);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,fx_aw,fx_ah,0,GL_RGBA,GL_UNSIGNED_BYTE,fx_griddata);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
    GL_ClearBindings();
}

void R_EffectsInit(void)
{
    Cvar_RegisterVariable(&r_mirrors);Cvar_RegisterVariable(&r_mirror_maxsize);
    Cvar_RegisterVariable(&r_vfog_quality);Cvar_RegisterVariable(&r_vfog_density);
}

void R_EffectsNewMap(void)
{
    int i,j;
    fx_mirror_map=fx_mirror_ready=false;fx_fog_map=fx_fog_explicit=false;fx_fogdensity=0;fx_height=256;
    fx_mirrorpasses=fx_fogpasses=fx_gridlights=0;
    free(fx_vis);fx_vis=NULL;free(fx_griddata);fx_griddata=NULL;
    glDeleteTextures(1,&fx_grid);fx_grid=0;
    VectorCopy(cl.worldmodel->mins,fx_min);VectorCopy(cl.worldmodel->maxs,fx_max);
    FX_ParseMap();
    if(!strcmp(cl.worldmodel->name,"maps/start.bsp")) {
        fx_mirror_map=FX_MirrorSupported();
        if(!fx_fog_explicit&&Fog_GetDensity()==0) {
            fx_fog_explicit=true;fx_fogdensity=.075f;FX_VectorSet(fx_fogcolor,.48f,.43f,.36f);
            FX_VectorSet(fx_min,160,192,0);FX_VectorSet(fx_max,1024,1392,320);fx_height=200;
        }
    }
    fx_fog_map=true; /* A density override can enable fog on an ordinary map. */
    for(i=0;i<3;i++) {
        if(!FX_Finite(fx_min[i])||!FX_Finite(fx_max[i])||fx_max[i]<=fx_min[i])fx_fog_map=false;
        fx_fogcolor[i]=FX_Finite(fx_fogcolor[i])?CLAMP(0,fx_fogcolor[i],1):0;
    }
    if(!FX_Finite(fx_height)||fx_height<16)fx_height=256;
    if(!FX_Finite(fx_fogdensity)||fx_fogdensity<0)fx_fogdensity=0;
    if(fx_mirror_map) {
        int bytes=(cl.worldmodel->numleafs+7)/8;fx_vis=(byte *)calloc(bytes,1);
        if(!fx_vis){fx_mirror_map=false;return;}
        for(i=0;i<5;i++) {
            vec3_t p;byte *pvs;mleaf_t *leaf;
            FX_MirrorPoint(p,1.5f,i>0?(i&1?-63:63):0,i>0?(i&2?79:9):44);
            leaf=Mod_PointInLeaf(p,cl.worldmodel);if(leaf->contents==CONTENTS_SOLID)continue;
            pvs=Mod_LeafPVS(leaf,cl.worldmodel);for(j=0;j<bytes;j++)fx_vis[j]|=pvs[j];
        }
    }
    R_AliasResetRenderCache();
}

void R_EffectsDelete(void)
{
    FX_DeleteTarget(&fx_main);FX_DeleteTarget(&fx_mirror);FX_DeleteTarget(&fx_fog);
    glDeleteTextures(1,&fx_grid);fx_grid=0;
    fx_copyprogram=fx_mirrorprogram=fx_marchprogram=fx_upsampleprogram=0;
    fx_api_checked=fx_api=fx_failed=fx_warned=false;fx_current=NULL;fx_mirror_ready=false;
}

byte *R_EffectsVisibility(void){return r_reflectionpass?fx_vis:NULL;}

qboolean R_EffectsSetupGL(void)
{
    if(fx_current)glViewport(0,0,fx_current->w,fx_current->h);
    if(!r_reflectionpass)return false;
    glMatrixMode(GL_PROJECTION);glLoadMatrixf(fx_reflectproj);
    glMatrixMode(GL_MODELVIEW);glLoadMatrixf(fx_reflectview);
    return true;
}

qboolean R_EffectsViewport(void){return fx_current!=NULL;}

int R_EffectsStencilBits(void){return fx_current?(fx_current->stencil?8:0):gl_stencilbits;}

void R_EffectsFogChanged(void)
{
    /* Console commands and server fades take precedence over the map profile. */
    fx_fog_explicit=false;fx_fog_map=true;
}

static float FX_Density(void)
{
    if(r_vfog_density.value>=0)return r_vfog_density.value/64;
    return (fx_fog_explicit?fx_fogdensity:Fog_GetDensity())/64;
}

qboolean R_EffectsUsingVFog(void)
{
    return fx_current&&fx_current->depth&&fx_fog_map&&r_vfog.value&&FX_Density()>0&&fx_grid&&fx_marchprogram&&!r_stereo.value;
}

void R_EffectsFog(void)
{
    float projection[16],view[16],vp[16],inverse[16],color[3],gridSize[3];int quality,w,h;
    fx_target_t *scene=fx_current;GLuint p;GLint oldfb;
    if(!R_EffectsUsingVFog())return;
    quality=CLAMP(1,(int)r_vfog_quality.value,3);fx_fogsteps=quality==1?24:quality==2?48:64;
    w=q_max(1,scene->w/(quality==3?1:2));h=q_max(1,scene->h/(quality==3?1:2));
    if(!FX_Target(&fx_fog,w,h,false))return;
    glGetFloatv(GL_PROJECTION_MATRIX,projection);glGetFloatv(GL_MODELVIEW_MATRIX,view);
    FX_Multiply(vp,projection,view);if(!FX_Inverse(inverse,vp))return;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING_EXT,&oldfb);
    GL_DisableMultitexture();fx_bindfb(GL_FRAMEBUFFER_EXT,fx_fog.fb);glViewport(0,0,w,h);
    p=fx_marchprogram;GL_UseProgramFunc(p);FX_UniformMatrix(p,"Inverse",inverse);
    FX_Uniform3(p,"Camera",r_origin);FX_Uniform3(p,"BoundsMin",fx_min);FX_Uniform3(p,"BoundsMax",fx_max);
    FX_VectorSet(gridSize,fx_nx,fx_ny,fx_nz);FX_Uniform3(p,"GridSize",gridSize);
    VectorCopy(fx_fog_explicit?fx_fogcolor:Fog_GetColor(),color);FX_Uniform3(p,"FogColor",color);
    GL_Uniform4fFunc(GL_GetUniformLocationFunc(p,"Atlas"),fx_aw,fx_ah,fx_cols,0);
    GL_Uniform4fFunc(GL_GetUniformLocationFunc(p,"ClipPlane"),
        r_reflectionpass?fx_normal[0]:0,r_reflectionpass?fx_normal[1]:0,
        r_reflectionpass?fx_normal[2]:0,r_reflectionpass?-fx_mirrordist:0);
    GL_Uniform1fFunc(GL_GetUniformLocationFunc(p,"Density"),CLAMP(0,FX_Density(),1));
    GL_Uniform1fFunc(GL_GetUniformLocationFunc(p,"Steps"),fx_fogsteps);
    glBindTexture(GL_TEXTURE_2D,scene->depth);GL_Uniform1iFunc(GL_GetUniformLocationFunc(p,"Depth"),0);
    GL_SelectTextureFunc(GL_TEXTURE1_ARB);glBindTexture(GL_TEXTURE_2D,fx_grid);
    GL_Uniform1iFunc(GL_GetUniformLocationFunc(p,"Grid"),1);GL_SelectTextureFunc(GL_TEXTURE0_ARB);
    glDisable(GL_BLEND);FX_Screen();
    /* Detach sampled depth while compositing into the scene. Its contents stay
     * intact and are reattached before drawing the gun/debug geometry. */
    fx_bindfb(GL_FRAMEBUFFER_EXT,scene->fb);
    fx_attachtex(GL_FRAMEBUFFER_EXT,GL_DEPTH_ATTACHMENT_EXT,GL_TEXTURE_2D,0,0);
    glViewport(0,0,scene->w,scene->h);p=fx_upsampleprogram;GL_UseProgramFunc(p);
    FX_UniformMatrix(p,"Inverse",inverse);FX_Uniform3(p,"Camera",r_origin);
    GL_Uniform4fFunc(GL_GetUniformLocationFunc(p,"Size"),w,h,.5f/w,.5f/h);
    glBindTexture(GL_TEXTURE_2D,fx_fog.color);GL_Uniform1iFunc(GL_GetUniformLocationFunc(p,"Image"),0);
    GL_SelectTextureFunc(GL_TEXTURE1_ARB);glBindTexture(GL_TEXTURE_2D,scene->depth);
    GL_Uniform1iFunc(GL_GetUniformLocationFunc(p,"Depth"),1);GL_SelectTextureFunc(GL_TEXTURE0_ARB);
    glEnable(GL_BLEND);glBlendFunc(GL_ONE,GL_SRC_ALPHA);FX_Screen();
    glDisable(GL_BLEND);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
    GL_SelectTextureFunc(GL_TEXTURE1_ARB);glBindTexture(GL_TEXTURE_2D,0);GL_SelectTextureFunc(GL_TEXTURE0_ARB);
    fx_attachtex(GL_FRAMEBUFFER_EXT,GL_DEPTH_ATTACHMENT_EXT,GL_TEXTURE_2D,scene->depth,0);
    fx_bindfb(GL_FRAMEBUFFER_EXT,oldfb);GL_UseProgramFunc(0);GL_ClearBindings();
    R_SetupGL();fx_fogpasses++;
}

static void FX_Quad(float offset,float u0,float u1,float z0,float z1)
{
    vec3_t point;
    /* Quake uses clockwise front faces. */
    glBegin(GL_QUADS);
    FX_MirrorPoint(point,offset,u0,z0);glVertex3fv(point);
    FX_MirrorPoint(point,offset,u1,z0);glVertex3fv(point);
    FX_MirrorPoint(point,offset,u1,z1);glVertex3fv(point);
    FX_MirrorPoint(point,offset,u0,z1);glVertex3fv(point);glEnd();
}

static void FX_FrameRing(float outerX,float y0,float y1,float z0,float z1,
    float innerX,float iy0,float iy1,float iz0,float iz1,float shade)
{
    const float edgeLight[4]={.55f,.8f,1.2f,1.0f};
    float outer[4][3],inner[4][3];
    int i,next;
    FX_MirrorPoint(outer[0],outerX,y0,z0);FX_MirrorPoint(outer[1],outerX,y1,z0);
    FX_MirrorPoint(outer[2],outerX,y1,z1);FX_MirrorPoint(outer[3],outerX,y0,z1);
    FX_MirrorPoint(inner[0],innerX,iy0,iz0);FX_MirrorPoint(inner[1],innerX,iy1,iz0);
    FX_MirrorPoint(inner[2],innerX,iy1,iz1);FX_MirrorPoint(inner[3],innerX,iy0,iz1);
    for(i=0;i<4;i++) {
        next=(i+1)%4;glColor3f(shade*edgeLight[i],shade*edgeLight[i]*1.04f,shade*edgeLight[i]*1.08f);
        glBegin(GL_QUADS);glVertex3fv(outer[i]);glVertex3fv(outer[next]);
        glVertex3fv(inner[next]);glVertex3fv(inner[i]);glEnd();
    }
}

void R_EffectsDrawMirror(void)
{
    if(r_reflectionpass||!fx_mirror_map)return;
    if(DotProduct(fx_normal,r_origin)<=fx_mirrordist||R_CullBox(fx_mirrormins,fx_mirrormaxs))return;
    GL_DisableMultitexture();glDisable(GL_FOG);glDisable(GL_TEXTURE_2D);
    /* Backing, outer bevel, flat metal face and recessed inner bevel. */
    glColor3f(.09f,.10f,.11f);FX_Quad(-.2f,-72,72,0,88);
    FX_FrameRing(-.2f,-72,72,0,88,1.5f,-70,70,2,86,.32f);
    FX_FrameRing(1.5f,-70,70,2,86,1.5f,-65,65,7,81,.23f);
    FX_FrameRing(1.5f,-65,65,7,81,0,-64,64,8,80,.12f);
    glColor3f(1,1,1);glEnable(GL_TEXTURE_2D);
    if(fx_mirror_ready&&r_mirrors.value) {
        GL_UseProgramFunc(fx_mirrorprogram);FX_UniformMatrix(fx_mirrorprogram,"Reflection",fx_reflectvp);
        glBindTexture(GL_TEXTURE_2D,fx_mirror.color);
        GL_Uniform1iFunc(GL_GetUniformLocationFunc(fx_mirrorprogram,"Image"),0);
        FX_Quad(0,-64,64,8,80);GL_UseProgramFunc(0);GL_ClearBindings();
    }
    Fog_EnableGFog();
}

static qboolean FX_IsStatic(entity_t *e)
{
    return (uintptr_t)e>=(uintptr_t)cl_static_entities&&(uintptr_t)e<(uintptr_t)(cl_static_entities+MAX_STATIC_ENTITIES);
}

static void FX_RenderMirror(void)
{
    refdef_t refdef;vec3_t origin,forward,right,up; mleaf_t *leaf,*oldleaf;entity_t *entity;
    entity_t *base[MAX_VISEDICTS];int count=0,i,stencilbits,limit,maxtexture,w,h;
    float reflection[16],eyePlane[4],inverseView[16],point[4],result[4],factor;
    fx_mirror_ready=false;
    if(!fx_mirror_map||!r_mirrors.value||DotProduct(fx_normal,r_origin)<=fx_mirrordist||R_CullBox(fx_mirrormins,fx_mirrormaxs)||r_stereo.value)return;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maxtexture);limit=CLAMP(128,(int)r_mirror_maxsize.value,q_min(maxtexture,4096));
    factor=q_min(1.0f,limit/(float)q_max(fx_mainw,fx_mainh));
    w=q_max(1,(int)(fx_mainw*factor));h=q_max(1,(int)(fx_mainh*factor));
    if(!FX_Target(&fx_mirror,w,h,true))return;
    refdef=r_refdef;VectorCopy(r_origin,origin);VectorCopy(vpn,forward);VectorCopy(vright,right);VectorCopy(vup,up);
    leaf=r_viewleaf;oldleaf=r_oldviewleaf;entity=currententity;stencilbits=gl_stencilbits;
    for(i=0;i<cl_numvisedicts;i++)if(!FX_IsStatic(cl_visedicts[i]))base[count++]=cl_visedicts[i];
    R_SetupGL();glGetFloatv(GL_MODELVIEW_MATRIX,fx_reflectview);glGetFloatv(GL_PROJECTION_MATRIX,fx_reflectproj);
    FX_Reflection(reflection,fx_normal,fx_mirrordist);FX_Multiply(fx_reflectview,fx_reflectview,reflection);
    /* Transform the room-side clipping plane by inverse-transpose(view). */
    FX_Inverse(inverseView,fx_reflectview);
    for(i=0;i<4;i++)eyePlane[i]=fx_normal[0]*inverseView[i*4]+fx_normal[1]*inverseView[i*4+1]
        +fx_normal[2]*inverseView[i*4+2]-fx_mirrordist*inverseView[i*4+3];
    if(!FX_Oblique(fx_reflectproj,eyePlane))return;
    FX_Multiply(fx_reflectvp,fx_reflectproj,fx_reflectview);
    for(i=0;i<3;i++)point[i]=origin[i];point[3]=1;FX_Transform(result,reflection,point);
    for(i=0;i<3;i++)r_origin[i]=r_refdef.vieworg[i]=result[i];
    for(i=0;i<3;i++)point[i]=forward[i];point[3]=0;FX_Transform(result,reflection,point);VectorCopy(result,vpn);
    for(i=0;i<3;i++)point[i]=right[i];FX_Transform(result,reflection,point);VectorCopy(result,vright);
    for(i=0;i<3;i++)point[i]=up[i];FX_Transform(result,reflection,point);VectorCopy(result,vup);
    {vec3_t visibility;FX_MirrorPoint(visibility,1.5f,0,44);r_viewleaf=Mod_PointInLeaf(visibility,cl.worldmodel);}
    r_reflectionpass=true;fx_current=&fx_mirror;gl_stencilbits=fx_mirror.stencil?8:0;
    fx_bindfb(GL_FRAMEBUFFER_EXT,fx_mirror.fb);
    cl_numvisedicts=count;memcpy(cl_visedicts,base,count*sizeof(*base));
    if(cl.viewentity>0&&cl.viewentity<cl.num_entities&&cl_entities[cl.viewentity].model) {
        qboolean found=false;for(i=0;i<count;i++)if(base[i]==&cl_entities[cl.viewentity])found=true;
        if(!found&&cl_numvisedicts<MAX_VISEDICTS)cl_visedicts[cl_numvisedicts++]=&cl_entities[cl.viewentity];
    }
    R_SetFrustum(r_fovx,r_fovy);R_MarkSurfaces();R_UpdateWarpTextures();
    /* Warp textures can change the framebuffer/viewport. */
    fx_bindfb(GL_FRAMEBUFFER_EXT,fx_mirror.fb);glViewport(0,0,w,h);
    glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT|(gl_stencilbits?GL_STENCIL_BUFFER_BIT:0));
    glFrontFace(GL_CCW);R_RenderScene();glFrontFace(GL_CW);
    r_reflectionpass=false;fx_current=NULL;gl_stencilbits=stencilbits;
    fx_bindfb(GL_FRAMEBUFFER_EXT,fx_destination);
    r_refdef=refdef;VectorCopy(origin,r_origin);VectorCopy(forward,vpn);VectorCopy(right,vright);VectorCopy(up,vup);
    r_viewleaf=leaf;r_oldviewleaf=oldleaf;currententity=entity;
    cl_numvisedicts=count;memcpy(cl_visedicts,base,count*sizeof(*base));
    R_SetFrustum(r_fovx,r_fovy);R_MarkSurfaces();R_SetupGL();
    fx_mirror_ready=true;fx_mirrorpasses++;
}

void R_EffectsBeginFrame(void)
{
    int scale=CLAMP(1,(int)r_scale.value,4);
    fx_mirrorpasses=fx_fogpasses=0;fx_fogsteps=0;fx_current=NULL;fx_mirror_ready=false;
    if(r_stereo.value||!FX_API()||!FX_Programs())return;
    fx_mainx=glx+r_refdef.vrect.x;fx_mainy=gly+glheight-r_refdef.vrect.y-r_refdef.vrect.height;
    fx_mainw=q_max(1,r_refdef.vrect.width/scale);fx_mainh=q_max(1,r_refdef.vrect.height/scale);
    glGetIntegerv(GL_FRAMEBUFFER_BINDING_EXT,&fx_destination);
    if(fx_fog_map&&r_vfog.value&&FX_Density()>0){FX_BuildGrid();FX_UploadGrid();}
    FX_RenderMirror();
    if(fx_fog_map&&r_vfog.value&&FX_Density()>0&&fx_grid&&FX_Target(&fx_main,fx_mainw,fx_mainh,true)&&fx_main.depth) {
        fx_current=&fx_main;fx_bindfb(GL_FRAMEBUFFER_EXT,fx_main.fb);
        glViewport(0,0,fx_main.w,fx_main.h);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT|(fx_main.stencil?GL_STENCIL_BUFFER_BIT:0));
    }
    GL_ClearBindings();
}

void R_EffectsEndFrame(void)
{
    if(fx_current==&fx_main) {
        fx_bindfb(GL_FRAMEBUFFER_EXT,fx_destination);glViewport(fx_mainx,fx_mainy,fx_mainw,fx_mainh);
        GL_DisableMultitexture();glBindTexture(GL_TEXTURE_2D,fx_main.color);
        GL_UseProgramFunc(fx_copyprogram);GL_Uniform1iFunc(GL_GetUniformLocationFunc(fx_copyprogram,"Image"),0);
        glDisable(GL_BLEND);FX_Screen();GL_UseProgramFunc(0);GL_ClearBindings();
        fx_current=NULL;R_SetupGL();
    }
}

void R_EffectsStatus(char *out,size_t size)
{
    q_snprintf(out,size,"\"renderEffects\":{\"mirrorPlaced\":%d,\"mirrorAvailable\":%d,\"mirrorPasses\":%d,\"mirrorSize\":[%d,%d],\"fogAvailable\":%d,\"fogPasses\":%d,\"fogSteps\":%d,\"fogLights\":%d,\"fogGrid\":[%d,%d,%d]}",
        fx_mirror_map,fx_mirror_ready,fx_mirrorpasses,fx_mirror.w,fx_mirror.h,fx_grid&&fx_main.depth&&fx_marchprogram?1:0,
        fx_fogpasses,fx_fogsteps,fx_gridlights,fx_nx,fx_ny,fx_nz);
}
