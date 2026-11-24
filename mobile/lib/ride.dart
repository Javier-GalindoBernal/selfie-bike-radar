import 'dart:convert';

class Ride {
  Ride(this.data, this.points, {this.elapsedMs = 0, this.segmentStart}) {
    data.putIfAbsent('max_speed_mps', () => 0.0);
    data.putIfAbsent('elevation_gain_m', () => 0.0);
  }
  final Map<String, dynamic> data;
  final List<Map<String, dynamic>> points;
  int elapsedMs;
  DateTime? segmentStart;
  double? _elevationAnchor;
  void resetElevationAnchor() => _elevationAnchor = null;
  void updateSensors(
      {double? speedMps, double? altitudeM, double? altitudeAccuracy}) {
    if (speedMps != null &&
        speedMps.isFinite &&
        speedMps >= 0 &&
        speedMps <= 50 &&
        speedMps > (data['max_speed_mps'] as num)) {
      data['max_speed_mps'] = speedMps;
    }
    if (altitudeM == null ||
        !altitudeM.isFinite ||
        altitudeM < -500 ||
        altitudeM > 9000 ||
        altitudeAccuracy == null ||
        !altitudeAccuracy.isFinite ||
        altitudeAccuracy <= 0 ||
        altitudeAccuracy > 15) {
      _elevationAnchor = null;
      return;
    }
    final anchor = _elevationAnchor;
    if (anchor == null) {
      _elevationAnchor = altitudeM;
      return;
    }
    final delta = altitudeM - anchor;
    if (delta >= 5 && delta <= 40) {
      data['elevation_gain_m'] =
          (data['elevation_gain_m'] as num).toDouble() + delta;
      _elevationAnchor = altitudeM;
    } else if (delta <= -5 || delta.abs() > 40) {
      _elevationAnchor = altitudeM;
    }
  }

  String get id => data['id'] as String;
  bool get active => data['status'] == 'active';
  bool get finished => data['status'] == 'finished';
  int durationMs(DateTime now) =>
      elapsedMs +
      (segmentStart == null ? 0 : now.difference(segmentStart!).inMilliseconds);
  void pause(DateTime now) {
    elapsedMs = durationMs(now);
    segmentStart = null;
    resetElevationAnchor();
    data['status'] = 'paused';
    data['duration_s'] = elapsedMs ~/ 1000;
  }

  void resume(DateTime now) {
    segmentStart = now;
    data['status'] = 'active';
  }

  Map<String, dynamic> remote(DateTime now) => {
        ...data,
        'duration_s': durationMs(now) ~/ 1000,
      };
  Map<String, dynamic> toJson() => {
        'data': data,
        'points': points,
        'elapsedMs': elapsedMs,
        'segmentStart': segmentStart?.toIso8601String(),
      };
  factory Ride.fromJson(Map<String, dynamic> json) => Ride(
        Map<String, dynamic>.from(json['data']),
        (json['points'] as List)
            .map((p) => Map<String, dynamic>.from(p))
            .toList(),
        elapsedMs: json['elapsedMs'] as int? ?? 0,
        segmentStart: DateTime.tryParse(json['segmentStart'] as String? ?? ''),
      );
  String gpx() {
    String escape(String s) => s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
    final segments = <String, List<Map<String, dynamic>>>{};
    for (final p in points) {
      segments
          .putIfAbsent('${p['_segment'] ?? p['segment'] ?? 0}', () => [])
          .add(p);
    }
    return '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx version="1.1" creator="Radar" xmlns="http://www.topografix.com/GPX/1/1">'
        '<trk><name>${escape(data['name'] as String)}</name>'
        '${segments.values.map((ps) => '<trkseg>${ps.map((p) => '<trkpt lat="${p['latitude']}" lon="${p['longitude']}">${p['altitude_m'] == null ? '' : '<ele>${p['altitude_m']}</ele>'}<time>${p['recorded_at']}</time></trkpt>').join()}</trkseg>').join()}'
        '</trk></gpx>';
  }

  String encode() => jsonEncode(toJson());
}
