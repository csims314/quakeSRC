#include "quakedef.h"
#include <emscripten/emscripten.h>

/* Queue commands for the engine's next frame. No reimplementation of gameplay. */
EMSCRIPTEN_KEEPALIVE void Web_Command(const char *command)
{
    if (command && *command) {
        Cbuf_AddText(command);
        Cbuf_AddText("\n");
    }
}

/* Small read-only snapshot for browser status and verification. */
EMSCRIPTEN_KEEPALIVE const char *Web_State(void)
{
    static char state[8192];
    const vec_t *origin = vec3_origin;
    int i, length;
    if (cl_entities && cls.state == ca_connected && cl.viewentity < cl.num_entities)
        origin = cl_entities[cl.viewentity].origin;
    q_snprintf(state, sizeof(state),
        "{\"time\":%.3f,\"connected\":%d,\"paused\":%d,\"health\":%d,\"ammo\":%d,"
        "\"origin\":[%.3f,%.3f,%.3f],\"angles\":[%.3f,%.3f,%.3f],"
        "\"signon\":%d,\"serverActive\":%d,\"serverTime\":%.3f,\"connections\":%d,"
        "\"map\":\"%s\",\"coop\":%d,\"deathmatch\":%d,\"nomonsters\":%d,\"skill\":%d,"
        "\"totalMonsters\":%d,\"killedMonsters\":%d,\"players\":[",
        cl.time, cls.state == ca_connected, cl.paused, cl.stats[STAT_HEALTH], cl.stats[STAT_AMMO],
        origin[0], origin[1], origin[2], cl.viewangles[0], cl.viewangles[1], cl.viewangles[2],
        cls.signon, sv.active, sv.time, net_activeconnections,
        sv.active ? sv.name : (cl.worldmodel ? cl.worldmodel->name : ""),
        (int)coop.value, (int)deathmatch.value, sv.nomonsters, current_skill,
        sv.active && pr_global_struct ? (int)pr_global_struct->total_monsters : cl.stats[STAT_TOTALMONSTERS],
        sv.active && pr_global_struct ? (int)pr_global_struct->killed_monsters : cl.stats[STAT_MONSTERS]);
    length = strlen(state);
    for (i = 0; i < (sv.active ? svs.maxclients : cl.maxclients); i++) {
        const vec_t *position;
        if (sv.active) {
            if (!svs.clients[i].active || !svs.clients[i].spawned) continue;
            position = svs.clients[i].edict->v.origin;
        } else {
            if (!cl_entities || i + 1 >= cl.num_entities || !cl_entities[i + 1].model) continue;
            position = cl_entities[i + 1].origin;
        }
        if (state[length - 1] != '[') state[length++] = ',';
        length += q_snprintf(state + length, sizeof(state) - length,
            "{\"slot\":%d,\"origin\":[%.3f,%.3f,%.3f]}", i + 1, position[0], position[1], position[2]);
    }
    q_strlcpy(state + length, "]}", sizeof(state) - length);
    return state;
}

/* Bounded, read-only world diagnostics for testing real monster replication.
 * This does not expose entity writes or replace any QuakeC behavior. */
static void Web_JsonString(char *out, size_t capacity, const char *in)
{
    size_t length = 0;
    const unsigned char *text = (const unsigned char *)in;
    while (*text && length + 7 < capacity) {
        unsigned char c = *text++;
        if (c == '"' || c == '\\') { out[length++] = '\\'; out[length++] = c; }
        else if (c < 32) length += q_snprintf(out + length, capacity - length, "\\u%04x", c);
        else out[length++] = c;
    }
    out[length] = 0;
}

EMSCRIPTEN_KEEPALIVE const char *Web_WorldState(void)
{
    static char state[262144];
    char classname[512], model[512];
    int i, length, emitted = 0, alive = 0, count = 0;
    q_snprintf(state, sizeof(state), "{\"time\":%.3f,\"server\":%d,\"actors\":[", sv.active ? sv.time : cl.time, sv.active);
    length = strlen(state);
    if (sv.active) {
        for (i = svs.maxclients + 1; i < sv.num_edicts; i++) {
            edict_t *entity = EDICT_NUM(i);
            const char *name;
            if (entity->free) continue;
            name = PR_GetString(entity->v.classname);
            if (!((int)entity->v.flags & FL_MONSTER) && Q_strncmp(name, "monster_", 8)) continue;
            count++;
            if (entity->v.health > 0) alive++;
            if (emitted >= 128) continue;
            Web_JsonString(classname, sizeof(classname), name);
            Web_JsonString(model, sizeof(model), PR_GetString(entity->v.model));
            length += q_snprintf(state + length, sizeof(state) - length,
                "%s{\"id\":%d,\"classname\":\"%s\",\"model\":\"%s\",\"health\":%.1f,"
                "\"frame\":%d,\"enemy\":%d,\"thinking\":%d,\"origin\":[%.3f,%.3f,%.3f]}",
                emitted++ ? "," : "", i, classname, model, entity->v.health,
                (int)entity->v.frame, entity->v.enemy / pr_edict_size, entity->v.nextthink > sv.time,
                entity->v.origin[0], entity->v.origin[1], entity->v.origin[2]);
        }
    } else if (cl_entities && cls.state == ca_connected) {
        for (i = cl.maxclients + 1; i < cl.num_entities; i++) {
            entity_t *entity = &cl_entities[i];
            if (!entity->model || entity->msgtime != cl.mtime[0]) continue;
            count++;
            if (emitted >= 128) continue;
            Web_JsonString(model, sizeof(model), entity->model->name);
            length += q_snprintf(state + length, sizeof(state) - length,
                "%s{\"id\":%d,\"model\":\"%s\",\"frame\":%d,\"origin\":[%.3f,%.3f,%.3f]}",
                emitted++ ? "," : "", i, model, entity->frame,
                entity->origin[0], entity->origin[1], entity->origin[2]);
        }
    }
    q_snprintf(state + length, sizeof(state) - length,
        "],\"count\":%d,\"alive\":%d,\"truncated\":%s}", count, alive, count > emitted ? "true" : "false");
    return state;
}
