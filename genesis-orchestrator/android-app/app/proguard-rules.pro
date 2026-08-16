# Keep protobuf-generated lite messages intact.
-keep class com.genesis.orchestrator.proto.** { *; }
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**
