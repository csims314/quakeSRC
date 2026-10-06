#include "quakedef.h"
#include "editor_bridge.h"
#include <emscripten/emscripten.h>

/* Each editor owns an isolated engine factory. None of these operations are
 * active in a normal game or multiplayer server. */
#define EDITOR_ENTITIES 8192
static char editor_ids[EDITOR_ENTITIES][65], editor_selection[65];
static qboolean editor_hidden[EDITOR_ENTITIES];
static qboolean editor_active, editor_simulating, editor_overlays = true;
static vec3_t editor_origin, editor_angles;
static float editor_fovy = 55;

qboolean Web_EditorActive(void) { return editor_active; }
void Web_EditorVisibilityOrigin(vec3_t origin) { if (editor_active) VectorCopy(editor_origin, origin); }
void Web_EditorClearTags(void) { memset(editor_ids, 0, sizeof(editor_ids)); memset(editor_hidden, 0, sizeof(editor_hidden)); }
void Web_EditorCaptureFrame(void) { if (editor_active) EM_ASM({if(Module.editorCaptureResolve){const resolve=Module.editorCaptureResolve;delete Module.editorCaptureResolve;resolve(Module.canvas.toDataURL("image/png"));}}); }
EMSCRIPTEN_KEEPALIVE void Web_EditorHide(const char *id, int hidden)
{
    int i;
    if (!editor_active) return;
    for (i = 0; i < EDITOR_ENTITIES; i++) if (*editor_ids[i] && !strcmp(editor_ids[i], id)) editor_hidden[i] = hidden != 0;
}
void Web_EditorTag(edict_t *entity, const char *id)
{
    int n = NUM_FOR_EDICT(entity);
    if (n >= 0 && n < EDITOR_ENTITIES && strlen(id) <= 64) {
        q_strlcpy(editor_ids[n], id, sizeof(editor_ids[n]));
        if (!*id) editor_hidden[n] = false;
    }
}
EMSCRIPTEN_KEEPALIVE void Web_EditorMode(int enabled)
{
    editor_active = enabled != 0;
    editor_simulating = true; /* Allow QuakeC startup/drop-to-floor before freeze. */
    if (!editor_active && sv.active) sv.paused = false;
}
EMSCRIPTEN_KEEPALIVE void Web_EditorCamera(float x, float y, float z, float pitch, float yaw, float fovy)
{
    if (!editor_active || !isfinite(x) || !isfinite(y) || !isfinite(z) ||
        !isfinite(pitch) || !isfinite(yaw) || !isfinite(fovy)) return;
    editor_origin[0] = CLAMP(-30000, x, 30000); editor_origin[1] = CLAMP(-30000, y, 30000); editor_origin[2] = CLAMP(-30000, z, 30000);
    editor_angles[0] = pitch; editor_angles[1] = yaw; editor_angles[2] = 0;
    editor_fovy = CLAMP(15, fovy, 120);
}
EMSCRIPTEN_KEEPALIVE void Web_EditorViewport(int width, int height)
{
    if (!editor_active || width < 64 || height < 64 || width > 4096 || height > 4096) return;
    vid.width = width; vid.height = height; vid.recalc_refdef = true;
}
EMSCRIPTEN_KEEPALIVE void Web_EditorSimulate(int enabled)
{
    if (!editor_active) return;
    editor_simulating = enabled != 0;
    if (sv.active) sv.paused = !editor_simulating;
}
EMSCRIPTEN_KEEPALIVE void Web_EditorSelect(const char *id, int overlays)
{
    q_strlcpy(editor_selection, id ? id : "", sizeof(editor_selection));
    editor_overlays = overlays != 0;
}
void Web_EditorApplyView(void)
{
    if (!editor_active) return;
    VectorCopy(editor_origin, r_refdef.vieworg);
    VectorCopy(editor_angles, r_refdef.viewangles);
    r_refdef.vrect.x = r_refdef.vrect.y = 0;
    r_refdef.vrect.width = vid.width; r_refdef.vrect.height = vid.height;
    r_refdef.fov_y = editor_fovy;
    r_refdef.fov_x = atan(tan(editor_fovy * M_PI / 360) * vid.width / vid.height) * 360 / M_PI;
    key_dest = key_game;
    if (sv.active) sv.paused = !editor_simulating;
    { int i, count = 0;
      for (i = 0; i < cl_numvisedicts; i++) {
          uintptr_t pointer = (uintptr_t)cl_visedicts[i], start = (uintptr_t)cl_entities;
          int n = pointer >= start && pointer < start + cl.num_entities * sizeof(entity_t) ? (pointer-start)/sizeof(entity_t) : -1;
          if (n >= 0 && n < EDITOR_ENTITIES && editor_hidden[n]) continue;
          cl_visedicts[count++] = cl_visedicts[i];
      }
      cl_numvisedicts = count;
    }
}
static edict_t *Web_EditorEntity(const char *id, int *number)
{
    int i;
    if (!editor_active || !sv.active || !id || !*id) return NULL;
    for (i = svs.maxclients + 1; i < sv.num_edicts && i < EDITOR_ENTITIES; i++)
        if (!strcmp(editor_ids[i], id) && !EDICT_NUM(i)->free) {
            if (number) *number = i;
            return EDICT_NUM(i);
        }
    return NULL;
}
EMSCRIPTEN_KEEPALIVE int Web_EditorTransform(const char *id, float x, float y, float z, float yaw)
{
    int n;
    edict_t *entity = Web_EditorEntity(id, &n);
    if (!entity || editor_simulating || !isfinite(x) || !isfinite(y) || !isfinite(z) || !isfinite(yaw) ||
        fabs(x) > 16384 || fabs(y) > 16384 || fabs(z) > 16384) return 0;
    if ((int)entity->v.modelindex && sv.models[(int)entity->v.modelindex]->type == mod_brush) return 0;
    entity->v.origin[0] = x; entity->v.origin[1] = y; entity->v.origin[2] = z;
    entity->v.angles[YAW] = yaw;
    SV_LinkEdict(entity, false);
    if (cl_entities && n < cl.num_entities) {
        VectorCopy(entity->v.origin, cl_entities[n].origin);
        VectorCopy(entity->v.angles, cl_entities[n].angles);
        cl_entities[n].lerpflags |= LERP_RESETMOVE;
    }
    return 1;
}
EMSCRIPTEN_KEEPALIVE int Web_EditorActivate(const char *id)
{
    edict_t *entity = Web_EditorEntity(id, NULL);
    ddef_t *globaldefs;
    int self, other, activator = 0, activator_offset = -1, i;
    if (!entity || !entity->v.use || !svs.clients[0].edict ||
        entity->v.use < 0 || entity->v.use >= progs->numfunctions) return 0;
    globaldefs = (ddef_t *)((byte *)progs + progs->ofs_globaldefs);
    self = pr_global_struct->self; other = pr_global_struct->other;
    editor_simulating = true; sv.paused = false;
    pr_global_struct->self = EDICT_TO_PROG(entity);
    pr_global_struct->other = EDICT_TO_PROG(svs.clients[0].edict);
    pr_global_struct->time = sv.time;
    for (i = 0; i < progs->numglobaldefs; i++)
        if (!strcmp(PR_GetString(globaldefs[i].s_name), "activator")) {
            activator_offset = globaldefs[i].ofs;
            activator = G_INT(activator_offset);
            G_INT(activator_offset) = pr_global_struct->other;
            break;
        }
    PR_ExecuteProgram(entity->v.use);
    pr_global_struct->self = self; pr_global_struct->other = other;
    if (activator_offset >= 0) G_INT(activator_offset) = activator;
    return 1;
}
/* Runtime-selected models/skins/frames come from QuakeC, not an editor model map. */
EMSCRIPTEN_KEEPALIVE const char *Web_EditorEntities(void)
{
    static char result[524288];
    int i, length = 1;
    result[0] = '[';
    if (editor_active && sv.active)
        for (i = svs.maxclients + 1; i < sv.num_edicts && i < EDITOR_ENTITIES; i++) {
            edict_t *entity = EDICT_NUM(i);
            qmodel_t *model;
            int m = (int)entity->v.modelindex;
            if (!*editor_ids[i] || entity->free || m <= 0 || m >= MAX_MODELS || !(model = sv.models[m])) continue;
            if (length + 1024 >= sizeof(result)) break;
            if (length > 1) result[length++] = ',';
            length += q_snprintf(result + length, sizeof(result) - length,
                "{\"id\":\"%s\",\"entity\":%d,\"model\":\"%s\",\"skin\":%d,\"frame\":%d,"
                "\"origin\":[%.3f,%.3f,%.3f],\"mins\":[%.3f,%.3f,%.3f],\"maxs\":[%.3f,%.3f,%.3f]}",
                editor_ids[i], i, model->name, (int)entity->v.skin, (int)entity->v.frame,
                entity->v.origin[0], entity->v.origin[1], entity->v.origin[2],
                model->mins[0], model->mins[1], model->mins[2], model->maxs[0], model->maxs[1], model->maxs[2]);
        }
    q_strlcpy(result + length, "]", sizeof(result) - length);
    return result;
}
void Web_EditorDrawSelection(void)
{
    edict_t *entity;
    int i, j, axis;
    vec3_t p;
    if (!editor_active || !editor_overlays || !(entity = Web_EditorEntity(editor_selection, NULL))) return;
    glDisable(GL_TEXTURE_2D); glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE);
    glColor3f(0.35f, 0.7f, 1.f);
    glBegin(GL_LINES);
    for (axis = 0; axis < 3; axis++) for (i = 0; i < 4; i++) for (j = 0; j < 2; j++) {
        int a = (axis + 1) % 3, b = (axis + 2) % 3;
        VectorCopy(entity->v.origin, p);
        p[axis] += j ? entity->v.maxs[axis] : entity->v.mins[axis];
        p[a] += (i & 1) ? entity->v.maxs[a] : entity->v.mins[a];
        p[b] += (i & 2) ? entity->v.maxs[b] : entity->v.mins[b];
        glVertex3fv(p);
    }
    glEnd(); glColor3f(1, 1, 1); glEnable(GL_TEXTURE_2D); glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
}
