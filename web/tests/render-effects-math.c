#include <assert.h>
#include <stdio.h>
#include "../../source/Quake/render_effects_math.h"
static void close_to(float a,float b){assert(fabsf(a-b)<.002f);}
int main(void)
{
    float mirror[16],inverse[16],identity[16],projection[16]={0};
    const float normal[3]={-1,0,0},point[4]={544,896,64,1},vector[4]={1,2,3,0};
    float reflected[4],restored[4],eyePlane[4]={0,0,-1,-10};int i;
    FX_Reflection(mirror,normal,-687.5f);
    FX_Transform(reflected,mirror,point);close_to(reflected[0],831);
    close_to(reflected[1],896);close_to(reflected[2],64);
    FX_Transform(restored,mirror,reflected);for(i=0;i<4;i++)close_to(restored[i],point[i]);
    FX_Transform(reflected,mirror,vector);close_to(reflected[0],-1);close_to(reflected[1],2);
    assert(FX_Inverse(inverse,mirror));FX_Multiply(identity,mirror,inverse);
    for(i=0;i<16;i++)close_to(identity[i],i%5==0?1:0);
    projection[0]=1;projection[5]=1.5f;projection[10]=-(1024.f+4)/(1024-4);
    projection[11]=-1;projection[14]=-2.f*1024*4/(1024-4);
    assert(FX_Oblique(projection,eyePlane));
    {float inside[4]={0,0,-20,1},outside[4]={0,0,-5,1},on[4]={0,0,-10,1};
    FX_Transform(reflected,projection,inside);assert(reflected[2]+reflected[3]>0);
    FX_Transform(reflected,projection,outside);assert(reflected[2]+reflected[3]<0);
    FX_Transform(reflected,projection,on);close_to(reflected[2]+reflected[3],0);}
    assert(FX_Inverse(inverse,projection));
    FX_Transform(reflected,projection,point);FX_Transform(restored,inverse,reflected);
    for(i=0;i<4;i++)close_to(restored[i],point[i]);
    memset(projection,0,sizeof(projection));assert(!FX_Inverse(inverse,projection));
    /* Front-to-back integration is invariant to subdivision in uniform fog. */
    {double sigma=.075/64,trans=1;for(i=0;i<48;i++)trans*=exp(-sigma*800/48);
    assert(fabs(trans-exp(-sigma*800))<1e-10);}
    puts("PASS reflection, inverse projection, clipping and fog transmittance");return 0;
}
