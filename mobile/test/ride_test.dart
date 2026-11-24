import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:radar_mobile/ride.dart';

void main() {
  final start = DateTime.utc(2026, 11, 23, 12);
  Ride ride() => Ride({
        'id': 'ride',
        'name': 'Ruta <norte> & sur',
        'status': 'active',
        'duration_s': 0
      }, [], segmentStart: start);

  test('la duración excluye todas las pausas, incluida la pausa final', () {
    final r = ride();
    r.pause(start.add(const Duration(seconds: 15)));
    expect(r.durationMs(start.add(const Duration(minutes: 5))), 15000);
    r.resume(start.add(const Duration(minutes: 5)));
    r.pause(start.add(const Duration(minutes: 5, seconds: 12)));
    expect(r.remote(start.add(const Duration(hours: 1)))['duration_s'], 27);
    expect(r.segmentStart, isNull);
  });
  test('JSON conserva IDs, cola de puntos, segmentos y tiempo acumulado', () {
    final r = ride();
    r.points.add({
      'id': 'stable-point-id',
      'latitude': 4.7,
      'longitude': -74.0,
      'recorded_at': start.toIso8601String(),
      '_segment': 2
    });
    r.pause(start.add(const Duration(seconds: 9)));
    final restored = Ride.fromJson(jsonDecode(r.encode()));
    expect(restored.points, r.points);
    expect(restored.id, r.id);
    expect(restored.durationMs(start), 9000);
    expect(restored.active, isFalse);
  });
  test('GPX escapa XML y separa trazas al reanudar', () {
    final r = ride();
    for (final segment in [1, 1, 2]) {
      r.points.add({
        'latitude': 4.7,
        'longitude': -74.0,
        'recorded_at': start.toIso8601String(),
        '_segment': segment
      });
    }
    final gpx = r.gpx();
    expect(gpx, contains('Ruta &lt;norte&gt; &amp; sur'));
    expect('<trkseg>'.allMatches(gpx).length, 2);
    expect('<trkpt '.allMatches(gpx).length, 3);
    expect(gpx, contains('http://www.topografix.com/GPX/1/1'));
  });
  test('GPX usa segment remoto cuando no hay _segment local', () {
    final r = ride();
    for (final segment in [0, 1]) {
      r.points.add({
        'latitude': 4.7,
        'longitude': -74.0,
        'recorded_at': start.toIso8601String(),
        'segment': segment
      });
    }
    expect('<trkseg>'.allMatches(r.gpx()).length, 2);
  });
  test('Máxima y ascenso filtran mediciones inválidas y no unen pausas', () {
    final r = ride();
    r.updateSensors(speedMps: 8, altitudeM: 1000, altitudeAccuracy: 5);
    r.updateSensors(speedMps: 7, altitudeM: 1002, altitudeAccuracy: 5);
    r.updateSensors(speedMps: 120, altitudeM: 1007, altitudeAccuracy: 5);
    expect(r.data['max_speed_mps'], 8);
    expect(r.data['elevation_gain_m'], 7);
    r.updateSensors(
        speedMps: double.nan, altitudeM: 1300, altitudeAccuracy: 50);
    expect(r.data['max_speed_mps'], 8);
    expect(r.data['elevation_gain_m'], 7);
    r.pause(start.add(const Duration(seconds: 10)));
    r.resume(start.add(const Duration(minutes: 1)));
    r.updateSensors(speedMps: 9, altitudeM: 1500, altitudeAccuracy: 5);
    expect(r.data['elevation_gain_m'], 7);
    expect(Ride.fromJson(jsonDecode(r.encode())).data['max_speed_mps'], 9);
  });
}
