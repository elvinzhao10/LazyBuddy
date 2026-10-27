# Intended architecture

## application:offline-notebook — Local notebook application

One local application that keeps notes readable, searchable, and exportable
without a network dependency.

## component:notes-ui — Note workspace

Users create, read, and find notes in a local workspace.

## component:note-store — Local note storage

Owns the durable note documents on local disk.

## interface:search-api — Local search

Reads the local index and answers find queries without a network.

## boundary:sync-service — Optional cloud sync

Cloud sync stays optional and must never gate a local workflow.
