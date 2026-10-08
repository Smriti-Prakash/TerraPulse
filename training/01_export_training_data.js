/**
 * TerraPulse - training-data export (Google Earth Engine Code Editor)
 *
 * HOW TO RUN
 *   1. Open https://code.earthengine.google.com  (free, sign in with the Google account you registered for Earth Engine)
 *   2. Paste this whole file into a new script and press Run.
 *   3. Check the map: the red box must cover Mudumalai and the yellow dots must sit on forest.
 *      Edit AOI below if it does not. (If you have the reserve boundary as an asset, replace AOI with it.)
 *   4. Open the "Tasks" tab (top right) and press RUN on the export. It writes
 *      terrapulse_training_points.csv to your Google Drive.
 *   5. Download that CSV into  terrapulse/training/data/  and run 02_train.py.
 *
 * WHAT ONE ROW MEANS
 *   One sample point in one year Y. Features describe how the point CHANGED between the
 *   dry-season window of year Y and the same window of year Y+1. The label comes from
 *   Hansen Global Forest Change: was there tree-cover loss at that point during year Y.
 *
 * HONEST LIMITS (say these in the review)
 *   - Hansen loss is YEARLY and counts loss from ANY cause (fire, felling, storms, harvest).
 *     The label is satellite-derived, not field-verified, and says nothing about legality.
 *   - Compare like with like: both windows are the same months, so leaf-fall is not mistaken for loss.
 */

// ---------- settings you may change ----------
var AOI = ee.Geometry.Rectangle([76.35, 11.50, 76.65, 11.75]);   // approximate Mudumalai area - CHECK ON THE MAP
var YEARS = [2019, 2020, 2021, 2022, 2023];       // loss years to build rows for. Needs Sentinel-2 in Y and Y+1.
var WINDOW_START = '01-01';                       // dry-season window (month-day), same in every year
var WINDOW_END   = '03-31';
var N_RANDOM = 4000;                              // random forest points (shows the real base rate)
var N_LOSS   = 1500;                              // extra points taken from loss pixels (so there are enough positives)
var SEED = 42;
// Check the Earth Engine Data Catalog for the newest Hansen version and use it if available:
var HANSEN_ID = 'UMD/hansen/global_forest_change_2024_v1_12';   // fallback: 'UMD/hansen/global_forest_change_2023_v1_11'
var FOREST_MIN_COVER = 30;                        // % tree cover in year 2000 to count as forest
// ---------------------------------------------

var hansen = ee.Image(HANSEN_ID);
var forest = hansen.select('treecover2000').gte(FOREST_MIN_COVER);
var lossyear = hansen.select('lossyear');         // 0 = no loss, 1..N = 2001..2000+N
var anyLoss = lossyear.gt(0);

// ---------- fixed sample points ----------
var rnd = forest.selfMask().rename('forest').sample({region: AOI, scale: 30, numPixels: N_RANDOM, seed: SEED, geometries: true})
  .map(function (f) { return f.set('stratum', 'random'); });
var lossPts = anyLoss.updateMask(forest).selfMask().rename('loss').sample({region: AOI, scale: 30, numPixels: N_LOSS, seed: SEED + 1, geometries: true})
  .map(function (f) { return f.set('stratum', 'loss_oversample'); });
var points = rnd.merge(lossPts);
// stable id per point
var list = points.toList(points.size());
points = ee.FeatureCollection(ee.List.sequence(0, points.size().subtract(1)).map(function (i) {
  return ee.Feature(list.get(i)).set('point_id', i);
}));

// ---------- helpers ----------
function s2Window(y) {
  var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(AOI).filterDate(y + '-' + WINDOW_START, y + '-' + WINDOW_END)
    .map(function (im) {                       // drop cloud, shadow, cirrus, snow using the scene classification band
      var scl = im.select('SCL');
      var ok = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
      return im.updateMask(ok);
    });
  var med = col.median();
  var ndvi = med.normalizedDifference(['B8', 'B4']).rename('ndvi');
  var nbr  = med.normalizedDifference(['B8', 'B12']).rename('nbr');
  return ndvi.addBands(nbr).set('n_scenes', col.size());
}
function s1Window(y) {
  var col = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(AOI).filterDate(y + '-' + WINDOW_START, y + '-' + WINDOW_END)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));
  return col.select(['VV', 'VH']).median().rename(['vv', 'vh']);
}
function rainYear(y) {
  return ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(y + '-01-01', y + '-12-31').sum().rename('rain');
}
var rainMean = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate('2000-01-01', '2020-12-31').sum().divide(21).rename('rain_mean');
function tempYear(y) {
  return ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR').filterDate(y + '-01-01', y + '-12-31').select('temperature_2m').mean().rename('temp');
}
function fireDays(y) {   // MODIS thermal-anomaly days in the year (1 km product) - context only
  return ee.ImageCollection('FIRMS').filterDate(y + '-01-01', y + '-12-31').select('T21').count().unmask(0).rename('fire_days');
}
var terrain = ee.Terrain.products(ee.Image('USGS/SRTMGL1_003'));

// ---------- one image of features per year ----------
function featuresFor(y) {
  var a = s2Window(y), b = s2Window(y + 1);
  var ra = s1Window(y), rb = s1Window(y + 1);
  return ee.Image.cat([
    b.select('ndvi').subtract(a.select('ndvi')).rename('d_ndvi'),
    b.select('nbr').subtract(a.select('nbr')).rename('d_nbr'),
    a.select('ndvi').rename('ndvi_before'),
    a.select('nbr').rename('nbr_before'),
    rb.select('vv').subtract(ra.select('vv')).rename('d_vv'),
    rb.select('vh').subtract(ra.select('vh')).rename('d_vh'),
    rainYear(y).subtract(rainMean).rename('rain_anom'),
    tempYear(y).subtract(tempYear(y - 1)).rename('temp_change'),
    fireDays(y),
    terrain.select('elevation').rename('elevation'),
    terrain.select('slope').rename('slope'),
    lossyear.rename('lossyear_raw'),
    ee.Image.constant(ee.Number(a.get('n_scenes'))).rename('n_scenes_before'),
    ee.Image.constant(ee.Number(b.get('n_scenes'))).rename('n_scenes_after')
  ]);
}

var perYear = YEARS.map(function (y) {
  var img = featuresFor(y);
  var rows = img.reduceRegions({collection: points, reducer: ee.Reducer.mean(), scale: 20, tileScale: 4});
  return rows.map(function (f) {
    var lon = f.geometry().coordinates().get(0), lat = f.geometry().coordinates().get(1);
    var ly = ee.Number(f.get('lossyear_raw'));
    return f.set({year: y, lon: lon, lat: lat,
                  lost_in_year: ly.eq(y - 2000),        // LABEL: Hansen loss during year Y
                  lost_before: ly.gt(0).and(ly.lt(y - 2000)) });  // already lost earlier - dropped in training
  });
});
var all = ee.FeatureCollection(perYear).flatten();

// ---------- check on the map, then export ----------
Map.centerObject(AOI, 11);
Map.setOptions('SATELLITE');
Map.addLayer(AOI, {color: 'red'}, 'AOI (check this covers Mudumalai)', true, 0.3);
Map.addLayer(rnd, {color: 'yellow'}, 'random forest points');
Map.addLayer(lossPts, {color: 'magenta'}, 'loss oversample points');
print('points', points.size());
print('Hansen version check - max loss year in this version (2000 + value):', lossyear.reduceRegion({reducer: ee.Reducer.max(), geometry: AOI, scale: 30, maxPixels: 1e9}));

Export.table.toDrive({
  collection: all,
  description: 'terrapulse_training_points',
  fileFormat: 'CSV',
  selectors: ['point_id', 'stratum', 'year', 'lon', 'lat', 'lost_in_year', 'lost_before', 'lossyear_raw',
              'd_ndvi', 'd_nbr', 'ndvi_before', 'nbr_before', 'd_vv', 'd_vh', 'rain_anom', 'temp_change',
              'fire_days', 'elevation', 'slope', 'n_scenes_before', 'n_scenes_after']
});
