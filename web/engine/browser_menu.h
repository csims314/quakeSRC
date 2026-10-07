#ifndef BROWSER_MENU_H
#define BROWSER_MENU_H

/* The editor and headless server have no browser menu callback and retain
 * the native menu behavior. Only the playable web client installs one. */
qboolean Web_OpenMenu(const char *page);
qboolean Web_ToggleMenu(void);
qboolean Web_MenuActive(void);
void Web_CloseMenu(void);

#endif
