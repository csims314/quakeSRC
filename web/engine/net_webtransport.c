/* QuakeSpasm WebTransport driver. GPL-2.0-or-later, as the engine. */
#include "q_stdinc.h"
#include "arch_def.h"
#include "net_sys.h"
#include "quakedef.h"
#include "net_defs.h"
#include "net_loop.h"
#include <emscripten/emscripten.h>

EM_JS(int, WT_Available, (void), { return Module['quakeTransport'] ? 1 : 0; });
EM_JS(int, WT_Prepared, (void), { return Module['quakeTransport'].prepared(); });
EM_JS(int, WT_Accept, (void), { return Module['quakeTransport'].accept(); });
EM_JS(int, WT_Alive, (int id), { return Module['quakeTransport'].alive(id) ? 1 : 0; });
EM_JS(int, WT_CanSend, (int id), { return Module['quakeTransport'].canSend(id) ? 1 : 0; });
EM_JS(int, WT_Receive, (int id, byte *data, int capacity, int *kind), {
    const message = Module['quakeTransport'].receive(id);
    if (!message) return Module['quakeTransport'].alive(id) ? 0 : -1;
    if (message.data.length > capacity) return -1;
    HEAPU8.set(message.data, data);
    HEAP32[kind >> 2] = message.kind;
    return message.data.length;
});
EM_JS(int, WT_Send, (int id, int kind, const byte *data, int length), {
    return Module['quakeTransport'].send(id, kind, HEAPU8.slice(data, data + length));
});
EM_JS(void, WT_Close, (int id), { Module['quakeTransport'].close(id); });

static qboolean wt_listening;
static int WT_Init(void) { return WT_Available() ? 0 : -1; }
static void WT_Listen(qboolean state) { wt_listening = state; }
static void WT_Search(qboolean xmit) { /* Explicit HTTPS endpoint; no LAN broadcast. */ }
static qsocket_t *WT_Socket(int id)
{
    qsocket_t *sock;
    if (!id) return NULL;
    sock = NET_NewQSocket();
    if (!sock) { WT_Close(id); return NULL; }
    sock->socket = id;
    q_strlcpy(sock->address, "WebTransport", sizeof(sock->address));
    return sock;
}
static qsocket_t *WT_Connect(const char *host)
{
    if (!host || q_strcasecmp(host, "webtransport")) return NULL;
    return WT_Socket(WT_Prepared());
}
static qsocket_t *WT_CheckNewConnections(void)
{
    return wt_listening ? WT_Socket(WT_Accept()) : NULL;
}
static int WT_GetMessage(qsocket_t *sock)
{
    int kind = 0;
    int length = WT_Receive(sock->socket, net_message.data, net_message.maxsize, &kind);
    if (length <= 0) return length;
    net_message.cursize = length;
    return kind;
}
static int WT_SendMessage(qsocket_t *sock, sizebuf_t *data)
{
    if (data->cursize <= 0 || data->cursize > NET_MAXMESSAGE) return -1;
    return WT_Send(sock->socket, 1, data->data, data->cursize);
}
static int WT_SendUnreliableMessage(qsocket_t *sock, sizebuf_t *data)
{
    if (data->cursize <= 0 || data->cursize > 1024) return 0;
    return WT_Send(sock->socket, 2, data->data, data->cursize);
}
static qboolean WT_CanSendMessage(qsocket_t *sock) { return WT_CanSend(sock->socket); }
static qboolean WT_CanSendUnreliableMessage(qsocket_t *sock) { return WT_Alive(sock->socket); }
static void WT_CloseSocket(qsocket_t *sock) { WT_Close(sock->socket); }
static void WT_Shutdown(void) { wt_listening = false; }

/* Loopback remains driver zero for single player. No legacy UDP driver is linked. */
net_driver_t net_drivers[] = {
    { "Loopback", false, Loop_Init, Loop_Listen, Loop_SearchForHosts, Loop_Connect,
      Loop_CheckNewConnections, Loop_GetMessage, Loop_SendMessage, Loop_SendUnreliableMessage,
      Loop_CanSendMessage, Loop_CanSendUnreliableMessage, Loop_Close, Loop_Shutdown },
    { "WebTransport", false, WT_Init, WT_Listen, WT_Search, WT_Connect,
      WT_CheckNewConnections, WT_GetMessage, WT_SendMessage, WT_SendUnreliableMessage,
      WT_CanSendMessage, WT_CanSendUnreliableMessage, WT_CloseSocket, WT_Shutdown }
};
const int net_numdrivers = Q_COUNTOF(net_drivers);
/* Retained symbols for shared engine code, with no LAN transport. */
net_landriver_t net_landrivers[1];
const int net_numlandrivers = 0;
