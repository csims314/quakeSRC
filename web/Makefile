# Browser build of the project's QuakeSpasm sources.
include Makefile.emscripten

USE_FLAGS = --use-port=sdl2 --use-port=zlib --use-port=vorbis
CFLAGS = -O2 -Wall -Wno-trigraphs -MMD $(USE_FLAGS) -I$(GL4ES_DIR)/include -I$(WEB_DIR)/engine -I. -DUSE_SDL2 -DSDL_FRAMEWORK -DDO_USERDIRS
DFLAGS = -DNDEBUG
LDFLAGS = $(USE_FLAGS) -O2 -sFULL_ES2=1 $(GL4ES_DIR)/lib/libGL.a \
  -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=65536 -sSTACK_SIZE=1048576 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=1073741824 \
  -sENVIRONMENT=web,node -sMODULARIZE=1 -sEXPORT_NAME=createQuakeSpasm \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_FUNCTIONS='["_main","_Web_Command","_Web_State","_Web_WorldState","_Web_SetMove","_Web_Look","_Web_Key","_Web_Viewport","_Web_EditorMode","_Web_EditorCamera","_Web_EditorViewport","_Web_EditorSimulate","_Web_EditorSelect","_Web_EditorEntities","_Web_EditorTransform","_Web_EditorHide","_Web_EditorActivate","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["callMain","ccall","cwrap","FS","IDBFS","UTF8ToString"]' \
  -sEXIT_RUNTIME=1
OBJS := $(filter-out net_bsd.o net_udp.o net_dgrm.o,$(OBJS)) browser_bridge.o net_webtransport.o editor_bridge.o
quakespasm: browser_bridge.o net_webtransport.o editor_bridge.o

editor_bridge.o: $(WEB_DIR)/engine/editor_bridge.c $(WEB_DIR)/engine/editor_bridge.h
	$(CC) $(DFLAGS) -c $(CFLAGS) -o $@ $<

browser_bridge.o: $(WEB_DIR)/engine/browser_bridge.c
	$(CC) $(DFLAGS) -c $(CFLAGS) -o $@ $<

net_webtransport.o: $(WEB_DIR)/engine/net_webtransport.c
	$(CC) $(DFLAGS) -c $(CFLAGS) -o $@ $<
