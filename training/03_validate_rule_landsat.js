/**
 * TerraPulse - retrospective validation of the vegetation-change rule (Landsat)   [Earth Engine Code Editor]
 *
 * PURPOSE
 *   Test, on REAL past events, whether a transparent vegetation-change rule would have flagged places where
 *   Hansen recorded tree-cover loss, and how many stable forest places the same rule flags wrongly.
 *   This script only EXPORTS the satellite values. The rule itself is applied afterwards in 04_evaluate_rule.py,
 *   so thresholds can be changed without re-running Earth Engine.
 *
 * ROLES OF EACH PIECE (keep this wording in the report)
 *   - Primary flag  : temporal vegetation-change rule = a drop in NDVI and NBR versus the same seasonal window of
 *                     earlier years, relative to the study-area median change. It flags POTENTIAL forest-cover change.
 *   - Hansen loss   : retrospective reference only (satellite-derived, yearly, any cause). Not field-verified,
 *                     not "illegal deforestation".
 *   - Random Forest : unchanged. Not used here.
 *
 * WHAT IS EXPORTED  (one row = one pixel x one validation year L)
 *   role = 'loss'    every forest pixel Hansen marks as lost in year L (a census, not a sample)
 *   role = 'control' forest pixels with no Hansen loss through 2023 (uniform random sample), evaluated in EVERY validation year
 *   For each row: Landsat NDVI, NBR and clear-observation count in the same fixed seasonal window of
 *   years L-3, L-2, L-1 (baseline), L and L+1 (after the event), plus fire-detection days around year L.
 *
 * WHY TWO "AFTER" WINDOWS: Hansen gives only the YEAR of loss, not the month. Loss early in year L shows in the
 * window of year L; loss later in year L shows in the window of year L+1. Both are exported and reported separately.
 * (This is retrospective detection, so after-event imagery is legitimate here. The leakage rules of the
 * training export do not apply to this validation.)
 *
 * HOW TO RUN: paste the whole file, press Run, read the Console (park match, loss pixels per year, scene counts),
 * then press RUN on the single export in the Tasks tab. Put the CSV in terrapulse/training/data/ and run 04_evaluate_rule.py.
 *
 * KNOWN LIMITS (also written into the evaluation report)
 *   - Landsat 7 has scan-line gaps after 2003 and is the only Landsat in early 2012; some pixels have few clear views.
 *     Pixels with too few clear views are reported as "not testable", never counted as hits or misses.
 *   - Landsat 5/7 and 8/9 differ slightly; the rule uses change relative to the study-area median, which absorbs most of this.
 *   - Fire context is MODIS (1 km), so it is a coarse "fire nearby in that period" indicator.
 *   - Only ~70 loss pixels exist in the study area, probably from a few events. Results are indicative, not precise.
 */

// ============================ settings ============================
var USE_PARK_BOUNDARY = true;
var BOUNDARY_NAME_CONTAINS = 'Mudumalai';
var BOUNDARY_ASSET = '';
var BOX = ee.Geometry.Rectangle([76.35, 11.50, 76.65, 11.75]);          // used only if USE_PARK_BOUNDARY = false
var HANSEN_ID = 'UMD/hansen/global_forest_change_2023_v1_11';
var FOREST_MIN_COVER = 30;
// Years with Hansen loss inside the study area, taken from your own histogram (2002 and 2003 are left out:
// they have no 3-year Landsat baseline). Loss years not listed here are not validated.
var VALIDATION_YEARS = [2006, 2007, 2008, 2009, 2011, 2012, 2013, 2014, 2017, 2023];
var WINDOW_START = '01-01';       // fixed seasonal window, same in every year (Jan-Mar had the lowest rainfall in your Console print)
var WINDOW_END = '03-31';
var N_CONTROL_DRAWS = 2500;       // random draws for stable-forest controls (about 90% land on forest)
var SEED = 42;
// ==================================================================

// ---------- study area (same logic as the training export) ----------
var STUDY_AREA, AOI;
if (USE_PARK_BOUNDARY) {
  var parkFc = BOUNDARY_ASSET ? ee.FeatureCollection(BOUNDARY_ASSET)
                              : ee.FeatureCollection('WCMC/WDPA/current/polygons').filter(ee.Filter.stringContains('NAME', BOUNDARY_NAME_CONTAINS));
  var nPark = parkFc.size().getInfo();
  if (nPark === 0) { throw new Error('No boundary polygon found. See the training export script for the options.'); }
  STUDY_AREA = parkFc.geometry().dissolve(100);
} else {
  STUDY_AREA = BOX;
}
AOI = STUDY_AREA.bounds();
print('Study area, km2:', STUDY_AREA.area(100).divide(1e6));

var hansen = ee.Image(HANSEN_ID);
var lossyear = hansen.select('lossyear');                    // "no loss" is a MASKED pixel in this dataset
var forest = hansen.select('treecover2000').gte(FOREST_MIN_COVER);

// ---------- Landsat Collection 2 Level 2: one harmonised composite per seasonal window ----------
function lsPrep(id, srcBands) {
  return function (y) {
    var s = ee.Date(y + '-' + WINDOW_START), e = ee.Date(y + '-' + WINDOW_END).advance(1, 'day');
    return ee.ImageCollection(id).filterBounds(AOI).filterDate(s, e).map(function (im) {
      var clear = im.select('QA_PIXEL').bitwiseAnd(63).eq(0);          // fill, dilated cloud, cirrus, cloud, shadow, snow
      var sr = im.select(srcBands, ['red', 'nir', 'swir2']).multiply(0.0000275).add(-0.2);
      return sr.updateMask(clear);
    });
  };
}
var LS5 = lsPrep('LANDSAT/LT05/C02/T1_L2', ['SR_B3', 'SR_B4', 'SR_B7']);
var LS7 = lsPrep('LANDSAT/LE07/C02/T1_L2', ['SR_B3', 'SR_B4', 'SR_B7']);
var LS8 = lsPrep('LANDSAT/LC08/C02/T1_L2', ['SR_B4', 'SR_B5', 'SR_B7']);
var LS9 = lsPrep('LANDSAT/LC09/C02/T1_L2', ['SR_B4', 'SR_B5', 'SR_B7']);
function lsCol(y) { return LS5(y).merge(LS7(y)).merge(LS8(y)).merge(LS9(y)); }

var MASKED = ee.Image.constant(0).updateMask(ee.Image.constant(0));
function lsStats(y) {                                         // ndvi, nbr, n = number of clear observations
  var col = lsCol(y);
  var med = col.median();
  var stats = ee.Image.cat([
    med.normalizedDifference(['nir', 'red']).rename('ndvi'),
    med.normalizedDifference(['nir', 'swir2']).rename('nbr'),
    col.select('red').count().unmask(0).rename('n')
  ]);
  var none = ee.Image.cat([MASKED.rename('ndvi'), MASKED.rename('nbr'), ee.Image.constant(0).rename('n')]);
  return ee.Image(ee.Algorithms.If(col.size().gt(0), stats, none));   // an empty window gives nulls and n = 0, not an error
}

var OFFSETS = [-3, -2, -1, 0, 1];
var TAGS = ['m3', 'm2', 'm1', 'z', 'p1'];                     // z = window of the loss year L itself
function evalImage(L) {
  var bands = [];
  OFFSETS.forEach(function (o, i) {
    var st = lsStats(L + o);
    bands.push(st.select('ndvi').rename('ndvi_' + TAGS[i]), st.select('nbr').rename('nbr_' + TAGS[i]), st.select('n').rename('n_' + TAGS[i]));
  });
  var fire = ee.ImageCollection('FIRMS').select('T21');
  bands.push(fire.filterDate(ee.Date(L + '-01-01'), ee.Date((L + 1) + '-01-01')).count().select([0]).unmask(0).rename('fire_days_year_L'));
  bands.push(fire.filterDate(ee.Date((L + 1) + '-' + WINDOW_START), ee.Date((L + 1) + '-' + WINDOW_END).advance(1, 'day')).count().select([0]).unmask(0).rename('fire_days_Lp1_window'));
  bands.push(lossyear.unmask(0).rename('lossyear_raw'));
  return ee.Image.cat(bands);
}

// ---------- reference pixels ----------
function addLL(f) {
  var c = f.geometry().coordinates();
  var lon = ee.Number(c.get(0)), lat = ee.Number(c.get(1));
  return f.set({lon: lon, lat: lat, pkey: lon.format('%.5f').cat('_').cat(lat.format('%.5f'))});
}
// census of Hansen loss pixels in the validation years (no numPixels => every unmasked pixel is returned)
var valOffsets = VALIDATION_YEARS.map(function (y) { return y - 2000; });
var lossSel = lossyear.remap(valOffsets, valOffsets).rename('lossyear').updateMask(forest);
var posPts = lossSel.sample({region: STUDY_AREA, scale: 30, geometries: true}).map(addLL);
// stable forest controls: forest in 2000 and no loss recorded through the last Hansen year
var stable = forest.and(lossyear.unmask(0).eq(0));
var controls = stable.selfMask().rename('c').sample({region: STUDY_AREA, scale: 30, numPixels: N_CONTROL_DRAWS, seed: SEED, geometries: true})
  .map(addLL).distinct('pkey').map(function (f) { return f.set('role', 'control'); });

// ---------- one table: controls in every validation year, loss pixels only in their own year ----------
var perYear = VALIDATION_YEARS.map(function (L) {
  var posL = posPts.filter(ee.Filter.eq('lossyear', L - 2000)).map(function (f) { return f.set('role', 'loss'); });
  var pts = controls.merge(posL).map(function (f) { return f.set('eval_year', L); });
  return evalImage(L).reduceRegions({collection: pts, reducer: ee.Reducer.mean(), scale: 30, tileScale: 8});
});
var all = ee.FeatureCollection(perYear).flatten();

// ---------- quick Console checks (cheap) ----------
print('Hansen loss pixels (30 m) used as the reference, by loss year, key 6 = 2006:', posPts.aggregate_histogram('lossyear'));
print('Loss pixels in total (should match your histogram for these years) | stable control pixels:',
      ee.Dictionary({loss_pixels: posPts.size(), control_pixels: controls.size()}));
var needed = [];
VALIDATION_YEARS.forEach(function (L) { OFFSETS.forEach(function (o) { if (needed.indexOf(L + o) < 0) { needed.push(L + o); } }); });
needed.sort();
print('Landsat scenes in each seasonal window (' + WINDOW_START + ' to ' + WINDOW_END + ') by sensor. Few scenes means more "not testable" pixels:',
  ee.List(needed.map(function (y) {
    return ee.Dictionary({window_year: y, ls5: LS5(y).size(), ls7: LS7(y).size(), ls8: LS8(y).size(), ls9: LS9(y).size()});
  })));
Map.setOptions('SATELLITE');
Map.centerObject(STUDY_AREA, 11);
Map.addLayer(STUDY_AREA, {color: 'red'}, 'Study area', true, 0.2);
Map.addLayer(controls, {color: '3b82f6'}, 'control pixels');
Map.addLayer(posPts, {color: 'ffff00'}, 'Hansen loss pixels');

// ---------- export ----------
var sel = ['pkey', 'role', 'eval_year', 'lon', 'lat', 'lossyear_raw'];
TAGS.forEach(function (t) { sel.push('ndvi_' + t, 'nbr_' + t, 'n_' + t); });
sel.push('fire_days_year_L', 'fire_days_Lp1_window');
Export.table.toDrive({collection: all, description: 'terrapulse_rule_validation_points', fileFormat: 'CSV', selectors: sel});
