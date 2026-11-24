import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import 'ride.dart';

class Tracker extends ChangeNotifier {
  Tracker(this.client, this.prefs);
  final SupabaseClient client;
  final SharedPreferences prefs;
  final List<Ride> rides = [];
  final List<Map<String, dynamic>> groups = [];
  final Set<String> pending = {};
  final Set<String> uploaded = {};
  bool _disposed = false;
  void changed() {
    if (!_disposed) notifyListeners();
  }

  void fail(Object e) {
    error = '$e';
    changed();
  }

  StreamSubscription<Position>? _gps;
  Timer? _retry;
  String? owner;
  String? error;
  bool syncing = false;
  bool remoteChecked = false;
  int _segment = 0;
  Position? _previous;
  Future<void> _writes = Future.value();
  Ride? get current => rides.where((r) => !r.finished).firstOrNull;
  String get _key => 'radar.v1.$owner';

  Future<void> load() async {
    owner = client.auth.currentUser!.id;
    final raw = prefs.getString(_key);
    if (raw != null) {
      final saved = jsonDecode(raw) as Map<String, dynamic>;
      rides.addAll((saved['rides'] as List).map((r) => Ride.fromJson(r)));
      pending.addAll((saved['pending'] as List).cast<String>());
      uploaded.addAll((saved['uploaded'] as List? ?? []).cast<String>());
      groups.addAll(
        (saved['groups'] as List).map((g) => Map<String, dynamic>.from(g)),
      );
      // A terminated process cannot prove how long GPS was recording.
      for (final r in rides.where((r) => r.active)) {
        r.elapsedMs = (r.data['duration_s'] as num).toInt() * 1000;
        r.segmentStart = null;
        r.data['status'] = 'paused';
        pending.add(r.id);
      }
      await save();
    }
    _retry = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(sync()),
    );
    unawaited(refresh());
  }

  Future<void> save() {
    final key = _key;
    final value = jsonEncode({
      'rides': rides.map((r) {
        final j = r.toJson();
        j['data'] = r.remote(DateTime.now().toUtc());
        return j;
      }).toList(),
      'pending': pending.toList(),
      'uploaded': uploaded.toList(),
      'groups': groups,
    });
    final write = _writes.then((_) async {
      if (!await prefs.setString(key, value)) {
        throw StateError('No fue posible guardar los datos en el dispositivo.');
      }
    });
    _writes = write.catchError((Object e) {
      error = '$e';
      changed();
    });
    return write;
  }

  Future<void> refresh() async {
    try {
      final result = await client.from('radar_groups').select();
      groups
        ..clear()
        ..addAll(result);
      final remote = await client
          .from('radar_rides')
          .select()
          .eq('user_id', owner!)
          .order('started_at');
      for (final row in remote) {
        if (rides.any((r) => r.id == row['id'])) continue;
        // Restore remote unfinished rides paused, requiring explicit GPS resume.
        final r = Ride(
          Map<String, dynamic>.from(row),
          [],
          elapsedMs: ((row['duration_s'] as num?)?.toInt() ?? 0) * 1000,
        );
        if (!r.finished) {
          r.data['status'] = 'paused';
          pending.add(r.id);
        }
        rides.add(r);
      }
      await save();
      remoteChecked = true;
      await sync();
    } catch (e) {
      error = 'Sin conexión o sin acceso: $e';
    }
    changed();
  }

  Future<void> group(bool create, String value, String member) async {
    await client.rpc(
      create ? 'radar_create_group' : 'radar_join_group',
      params: {
        if (create) 'group_name': value.trim() else 'code': value.trim(),
        'member_name': member.trim(),
      },
    );
    await refresh();
  }

  Future<void> permission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw StateError('Activa la ubicación del dispositivo.');
    }
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) {
      p = await Geolocator.requestPermission();
    }
    if (p == LocationPermission.denied ||
        p == LocationPermission.deniedForever) {
      throw StateError(
        'Permiso GPS denegado. Habilítalo en los ajustes del dispositivo.',
      );
    }
  }

  Future<void> start(String name, String? groupId) async {
    if (!remoteChecked) {
      throw StateError(
        'Conecta una vez para comprobar que no tienes otra salida abierta.',
      );
    }
    if (groupId == null) {
      throw StateError('Crea o selecciona un grupo privado.');
    }
    if (name.trim().length > 120) {
      throw StateError('Nombre máximo: 120 caracteres.');
    }
    if (current != null) {
      throw StateError('Finaliza el recorrido pendiente primero.');
    }
    await permission();
    final now = DateTime.now().toUtc();
    final r = Ride(
      {
        'id': const Uuid().v4(),
        'user_id': owner,
        'group_id': groupId,
        'name': name.trim().isEmpty ? 'Mi recorrido' : name.trim(),
        'status': 'active',
        'started_at': now.toIso8601String(),
        'ended_at': null,
        'distance_m': 0.0,
        'duration_s': 0,
      },
      [],
      segmentStart: now,
    );
    rides.add(r);
    pending.add(r.id);
    await save();
    _listen();
    changed();
    unawaited(sync());
  }

  LocationSettings get locationSettings {
    if (defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
          accuracy: LocationAccuracy.best,
          distanceFilter: 5,
          intervalDuration: const Duration(seconds: 5),
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'Radar · Recorrido activo',
            notificationText:
                'Registrando tu ubicación. Abre Radar para pausar o finalizar.',
            enableWakeLock: true,
          ));
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return AppleSettings(
          accuracy: LocationAccuracy.best,
          distanceFilter: 5,
          activityType: ActivityType.fitness,
          pauseLocationUpdatesAutomatically: false,
          showBackgroundLocationIndicator: true,
          allowBackgroundLocationUpdates: true);
    }
    return const LocationSettings(
        accuracy: LocationAccuracy.best, distanceFilter: 5);
  }

  void _listen() {
    _previous = null;
    _segment++;
    final r = current;
    if (r != null && r.points.isNotEmpty) {
      _segment = (r.points
              .map(
                  (p) => (p['_segment'] as int?) ?? (p['segment'] as int?) ?? 0)
              .reduce((a, b) => a > b ? a : b)) +
          1;
    }
    _gps = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen(
      (p) {
        unawaited(_record(p).catchError(fail));
      },
      onError: (Object e) {
        error = 'GPS interrumpido: $e';
        unawaited(pause().catchError(fail));
      },
    );
  }

  Future<void> _record(Position p) async {
    final r = current;
    if (r == null ||
        !r.active ||
        !p.latitude.isFinite ||
        !p.longitude.isFinite ||
        !p.accuracy.isFinite ||
        p.accuracy > 100 ||
        p.accuracy < 0 ||
        p.latitude.abs() > 90 ||
        p.longitude.abs() > 180 ||
        p.timestamp.toUtc().isBefore(DateTime.parse(r.data['started_at'])) ||
        p.timestamp.toUtc().isAfter(
              DateTime.now().toUtc().add(const Duration(minutes: 5)),
            )) {
      return;
    }
    if (_previous != null && !p.timestamp.isAfter(_previous!.timestamp)) return;
    if (_previous != null) {
      final distance = Geolocator.distanceBetween(
        _previous!.latitude,
        _previous!.longitude,
        p.latitude,
        p.longitude,
      );
      final seconds =
          p.timestamp.difference(_previous!.timestamp).inMilliseconds / 1000;
      if (seconds > 120) {
        // No unir con una recta dos muestras separadas por una interrupción del GPS.
        _segment++;
        r.resetElevationAnchor();
      } else {
        if (seconds <= 0 || distance / seconds > 50) return;
        r.data['distance_m'] =
            (r.data['distance_m'] as num).toDouble() + distance;
      }
    }
    _previous = p;
    final altitude = p.altitude.isFinite &&
            p.altitude >= -500 &&
            p.altitude <= 9000 &&
            p.altitudeAccuracy.isFinite &&
            p.altitudeAccuracy > 0 &&
            p.altitudeAccuracy <= 15
        ? p.altitude
        : null;
    r.updateSensors(
        speedMps: p.speed,
        altitudeM: altitude,
        altitudeAccuracy: p.altitudeAccuracy);
    r.points.add({
      'id': const Uuid().v4(),
      'ride_id': r.id,
      'user_id': owner,
      'latitude': p.latitude,
      'longitude': p.longitude,
      'accuracy_m': p.accuracy,
      'altitude_m': altitude,
      'speed_mps':
          !p.speed.isFinite || p.speed < 0 || p.speed > 50 ? null : p.speed,
      'recorded_at': p.timestamp.toUtc().toIso8601String(),
      '_segment': _segment,
    });
    r.data['duration_s'] = r.durationMs(DateTime.now().toUtc()) ~/ 1000;
    pending.add(r.id);
    await save();
    changed();
  }

  Future<void> pause() async {
    final r = current;
    if (r == null || !r.active) return;
    r.pause(DateTime.now().toUtc());
    await _gps?.cancel();
    _gps = null;
    _previous = null;
    pending.add(r.id);
    await save();
    changed();
    unawaited(sync());
  }

  Future<void> resume() async {
    final r = current;
    if (r == null || r.active) return;
    await permission();
    r.resume(DateTime.now().toUtc());
    pending.add(r.id);
    await save();
    _listen();
    changed();
    unawaited(sync());
  }

  Future<void> finish() async {
    await pause();
    final r = current;
    if (r == null) return;
    r.data['status'] = 'finished';
    r.data['ended_at'] = DateTime.now().toUtc().toIso8601String();
    pending.add(r.id);
    await save();
    changed();
    unawaited(sync());
  }

  Future<void> sync() async {
    if (syncing || client.auth.currentUser?.id != owner) return;
    syncing = true;
    changed();
    try {
      final ids = pending.toList()
        ..sort((a, b) {
          final ra = rides.firstWhere((r) => r.id == a);
          final rb = rides.firstWhere((r) => r.id == b);
          return (ra.finished ? 0 : 1).compareTo(rb.finished ? 0 : 1);
        });
      for (final id in ids) {
        final r = rides.firstWhere((r) => r.id == id);
        final snapshot = r.encode();
        final row = r.remote(DateTime.now().toUtc());
        await client
            .from('radar_rides')
            .upsert(row, onConflict: 'id', ignoreDuplicates: true);
        await client
            .from('radar_rides')
            .update({
              for (final key in [
                'status',
                'ended_at',
                'distance_m',
                'duration_s',
                'name',
                'max_speed_mps',
                'elevation_gain_m',
              ])
                key: row[key],
            })
            .eq('id', r.id)
            .eq('user_id', owner!);
        final points =
            r.points.where((p) => !uploaded.contains(p['id'])).map((p) {
          final row = Map<String, dynamic>.from(p);
          row['segment'] = row.remove('_segment') ?? row['segment'] ?? 0;
          return row;
        }).toList();
        for (var i = 0; i < points.length; i += 200) {
          await client.from('radar_points').upsert(
                points.sublist(
                  i,
                  i + 200 > points.length ? points.length : i + 200,
                ),
                onConflict: 'id',
                ignoreDuplicates: true,
              );
        }
        uploaded.addAll(points.map((p) => p['id'] as String));
        if (snapshot == r.encode()) pending.remove(id);
        await save();
      }
      error = null;
    } catch (e) {
      error = 'Pendiente de sincronizar: $e';
    } finally {
      syncing = false;
      changed();
    }
  }

  Future<void> hydrate(Ride r) async {
    if (pending.contains(r.id)) return;
    var offset = 0;
    final loaded = <Map<String, dynamic>>[];
    while (true) {
      final rows = await client
          .from('radar_points')
          .select()
          .eq('ride_id', r.id)
          .order('recorded_at')
          .range(offset, offset + 999);
      loaded.addAll(rows.map((p) => {...p, '_segment': p['segment'] ?? 0}));
      if (rows.length < 1000) break;
      offset += 1000;
    }
    final existing = r.points.map((p) => p['id']).toSet();
    r.points.addAll(loaded.where((p) => !existing.contains(p['id'])));
    r.points.sort((a, b) =>
        (a['recorded_at'] as String).compareTo(b['recorded_at'] as String));
    uploaded.addAll(loaded.map((p) => p['id'] as String));
    await save();
    changed();
  }

  @override
  void dispose() {
    _disposed = true;
    _retry?.cancel();
    unawaited(_gps?.cancel());
    super.dispose();
  }
}
