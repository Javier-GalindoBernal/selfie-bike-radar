import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:radar_mobile/tracker.dart';
import 'package:radar_mobile/ride.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const uid = '00000000-0000-4000-8000-000000000001';
  const rid = '00000000-0000-4000-8000-000000000002';
  late SupabaseClient client;
  late Tracker tracker;
  final requests = <http.Request>[];
  bool offline = false;
  setUp(() async {
    requests.clear();
    offline = false;
    SharedPreferences.setMockInitialValues({});
    client = SupabaseClient('https://example.supabase.co', 'public-test-key',
        authOptions: const AuthClientOptions(autoRefreshToken: false),
        httpClient: MockClient((request) async {
      requests.add(request);
      if (offline) {
        return http.Response('{"message":"offline"}', 503, request: request);
      }
      return http.Response(request.method == 'GET' ? '[]' : '',
          request.method == 'POST' ? 201 : 200,
          request: request, headers: {'content-type': 'application/json'});
    }));
    await client.auth.setInitialSession(jsonEncode({
      'access_token': 'test-token',
      'refresh_token': 'test-refresh',
      'token_type': 'bearer',
      'expires_at': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
      'user': {
        'id': uid,
        'app_metadata': {},
        'user_metadata': {},
        'aud': 'authenticated',
        'created_at': '2026-11-23T00:00:00Z'
      },
    }));
    tracker = Tracker(client, await SharedPreferences.getInstance())
      ..owner = uid;
  });
  tearDown(() async {
    tracker.dispose();
    await client.dispose();
  });
  Ride sample() => Ride({
        'id': rid,
        'user_id': uid,
        'group_id': 'group',
        'name': 'Salida',
        'status': 'finished',
        'started_at': '2026-11-23T10:00:00Z',
        'ended_at': '2026-11-23T11:00:00Z',
        'distance_m': 10.0,
        'duration_s': 60
      }, [
        {
          'id': 'point',
          'ride_id': rid,
          'user_id': uid,
          'latitude': 4.7,
          'longitude': -74.0,
          'accuracy_m': 10.0,
          'speed_mps': null,
          'recorded_at': '2026-11-23T10:01:00Z',
          '_segment': 1
        }
      ], elapsedMs: 60000);

  test('offline conserva cola; reintento usa IDs y columnas permitidas',
      () async {
    tracker.rides.add(sample());
    tracker.pending.add(rid);
    offline = true;
    await tracker.sync();
    expect(tracker.pending, contains(rid));
    await tracker.save();
    final stored = jsonDecode(tracker.prefs.getString('radar.v1.$uid')!);
    expect(stored['pending'], [rid]);
    offline = false;
    requests.clear();
    await tracker.sync();
    expect(tracker.error, isNull);
    expect(tracker.pending, isEmpty);
    final patch = requests.singleWhere((r) => r.method == 'PATCH');
    expect((jsonDecode(patch.body) as Map).keys.toSet(), {
      'status',
      'ended_at',
      'distance_m',
      'duration_s',
      'name',
      'max_speed_mps',
      'elevation_gain_m'
    });
    final pointRequest =
        requests.singleWhere((r) => r.url.path.endsWith('radar_points'));
    expect(pointRequest.headers['prefer'],
        contains('resolution=ignore-duplicates'));
    final point = (jsonDecode(pointRequest.body) as List).single as Map;
    expect(point['id'], 'point');
    expect(point.containsKey('_segment'), false);
    expect(point['segment'], 1);
    tracker.pending.add(rid);
    requests.clear();
    await tracker.sync();
    expect(requests.where((r) => r.url.path.endsWith('radar_points')), isEmpty);
  });
  test('recuperación pausa una salida activa en último checkpoint persistido',
      () async {
    final r = sample();
    r.data['status'] = 'active';
    r.data['ended_at'] = null;
    r.segmentStart =
        DateTime.now().toUtc().subtract(const Duration(seconds: 5));
    tracker.rides.add(r);
    tracker.pending.add(rid);
    await tracker.save();
    final recovered = Tracker(client, tracker.prefs);
    await recovered.load();
    expect(recovered.current!.active, false);
    expect(recovered.current!.segmentStart, isNull);
    expect(recovered.current!.elapsedMs, greaterThanOrEqualTo(65000));
    await Future<void>.delayed(const Duration(milliseconds: 100));
    recovered.dispose();
  });
}
