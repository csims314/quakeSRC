/* Pure, column-major render math shared by the effects and their native tests.
 * SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef RENDER_EFFECTS_MATH_H
#define RENDER_EFFECTS_MATH_H
#include <math.h>
#include <string.h>

static void FX_Multiply(float out[16], const float a[16], const float b[16])
{
    float c[16]; int row, col, k;
    for (col=0; col<4; col++) for (row=0; row<4; row++) {
        c[col*4+row]=0;
        for (k=0; k<4; k++) c[col*4+row]+=a[k*4+row]*b[col*4+k];
    }
    memcpy(out,c,sizeof(c));
}

static int FX_Inverse(float out[16], const float in[16])
{
    double a[4][8]; int i,j,k,p;
    for (i=0;i<4;i++) for(j=0;j<8;j++) a[i][j]=j<4?in[j*4+i]:(j-4==i);
    for(i=0;i<4;i++) {
        p=i; for(j=i+1;j<4;j++) if(fabs(a[j][i])>fabs(a[p][i])) p=j;
        if(fabs(a[p][i])<1e-12) return 0;
        if(p!=i) for(k=0;k<8;k++){double v=a[i][k];a[i][k]=a[p][k];a[p][k]=v;}
        {double v=a[i][i];for(k=0;k<8;k++) a[i][k]/=v;}
        for(j=0;j<4;j++) if(j!=i){double v=a[j][i];for(k=0;k<8;k++) a[j][k]-=v*a[i][k];}
    }
    for(i=0;i<4;i++) for(j=0;j<4;j++) out[j*4+i]=(float)a[i][j+4];
    return 1;
}

/* plane dot(n,p)=distance; n must be a unit normal. */
static void FX_Reflection(float m[16], const float n[3], float distance)
{
    int i,j; memset(m,0,16*sizeof(float)); m[15]=1;
    for(i=0;i<3;i++) {
        for(j=0;j<3;j++) m[j*4+i]=(i==j?1.0f:0.0f)-2*n[i]*n[j];
        m[12+i]=2*distance*n[i];
    }
}

static void FX_Transform(float out[4], const float m[16], const float p[4])
{
    int i; for(i=0;i<4;i++) out[i]=m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]*p[3];
}

/* Replace the near plane while retaining the original x/y projection. */
static int FX_Oblique(float projection[16], const float planeEye[4])
{
    float inverse[16], corner[4], q[4], dot; int i;
    if(!FX_Inverse(inverse,projection)) return 0;
    corner[0]=planeEye[0]>=0?1:-1; corner[1]=planeEye[1]>=0?1:-1;
    corner[2]=corner[3]=1; FX_Transform(q,inverse,corner);
    dot=0; for(i=0;i<4;i++) dot+=planeEye[i]*q[i];
    if(fabsf(dot)<1e-6f) return 0;
    for(i=0;i<4;i++) projection[i*4+2]=planeEye[i]*(2/dot)-projection[i*4+3];
    return 1;
}
#endif
