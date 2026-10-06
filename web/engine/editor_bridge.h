#ifndef WEB_EDITOR_BRIDGE_H
#define WEB_EDITOR_BRIDGE_H
qboolean Web_EditorActive(void);
void Web_EditorApplyView(void);
void Web_EditorDrawSelection(void);
void Web_EditorTag(edict_t *entity, const char *id);
void Web_EditorClearTags(void);
#endif
