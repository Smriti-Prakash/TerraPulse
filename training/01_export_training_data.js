/**
 * TerraPulse - training-data export (Google Earth Engine Code Editor)   [corrected version]
 *
 * HOW TO RUN
 *   1. Open https://code.earthengine.google.com, paste this whole file into a new script, press Run.
 *   2. Read the Console: the park-boundary match (check the names!), sample counts, Sentinel scene counts,
 *      monthly rainfall, and the data-quality summary (can take a minute or two). Check the map: the red
 *      outline must be Mudumalai; blue/red dots are the training/evaluation areas.
 *   3. Open the Tasks tab and press RUN on BOTH exports:
 *        terrapulse_training_points.csv   (the dataset)
 *        terrapulse_training_qa.csv       (one row of the same data-quality counts, kept for your records)
 *   4. Put the first file in terrapulse/training/data/ and run 02_train.py.
 *
 * ---------------------------------------------------------------------------------------------
 * ROW DEFINITION - read this once, it is the part that prevents temporal leakage
 * ---------------------------------------------------------------------------------------------
 *  One row = one sample point x one TARGET YEAR y (a calendar year).
 *
 *  LABEL   lost_in_year = 1 if Hansen 'lossyear' == y - 2000 at the point, i.e. satellite-derived
 *          tree-cover loss was recorded in calendar year y. Hansen gives only the year, not the month.
 *
 *  FEATURES use only imagery/data dated BEFORE the label year starts (FEATURE_LAG = 1):
 *          RECENT window R = y-1  (e.g. 1 Jan - 31 Mar of y-1)
 *          OLDER  window O = y-2  (the same months)
 *          d_ndvi, d_nbr, d_vv, d_vh = value(R) - value(O)       -> year-to-year change
 *          ndvi_prev, nbr_prev       = value(R)                  -> level before the target year
 *          rain_anom_12m, temp_anom_12m, fire_days_12m           -> the 12 months ending when window R ends
 *          elevation, slope                                      -> static terrain
 *       Nothing from year y or y+1 is used. Latest data used for a row = end of window R, which is
 *       before 1 January of y.
 *
 *  What this means: the model asks "given the state and recent change before year y, at which places
 *  was tree cover then lost in year y?" It is a loss-RISK model, not a same-day detector.
 *  (Setting FEATURE_LAG = 0 uses R = y and O = y-1, i.e. it adds imagery from the first months of year y.
 *  Hansen cannot say in which month the loss happened, so loss early in y could then be seen in the
 *  features. That is concurrent detection, not forecasting. Keep 1 unless you deliberately want it.)
 *
 *  Dates are used only to build windows and changes. 'year' is exported as a split key, NOT a model input.
 *
 * ---------------------------------------------------------------------------------------------
 * SAMPLING AND SPLITS (so the evaluation numbers are honest)
 * ---------------------------------------------------------------------------------------------
 *  - ONE uniform random sample of forest pixels, so the real prevalence of loss is preserved.
 *  - The area is cut into square blocks (BLOCK_DEG). Whole blocks are assigned to 'train' or 'eval'.
 *    Points closer than EDGE_MARGIN_DEG to a block edge are dropped, leaving a gap between blocks
 *    (spatial autocorrelation still exists beyond the gap; treat the result as a fair, not perfect, test).
 *  - 'role' column:
 *        train                  train blocks, years before TEST_YEAR
 *        test_spatial           eval blocks,  years before TEST_YEAR   (unseen places)
 *        test_temporal          train blocks, TEST_YEAR                (unseen year)
 *        test_spatial_temporal  eval blocks,  TEST_YEAR                (unseen places AND unseen year)
 *  - Optional ENRICH_TRAIN_WITH_LOSS (default OFF) adds extra loss pixels to TRAIN blocks only,
 *    chosen from loss years BEFORE TEST_YEAR, de-duplicated against the uniform sample. Every test role
 *    stays representative. Enriched rows are marked sample_source = 'loss_enrichment'.
 *    If the number of positives is low the script WARNS; it never creates positives by itself.
 *
 * LABEL HONESTY
 *  lost_in_year is satellite-derived tree-cover loss from ANY cause (fire, felling, storm, harvest,
 *  plantation rotation). It is not field-verified and says nothing about legality.
 */

// ============================ settings you may change ============================
// Study area = the official protected-area polygon (WDPA, in the Earth Engine catalog), so only Mudumalai is sampled.
var USE_PARK_BOUNDARY = true;
var BOUNDARY_NAME_CONTAINS = 'Mudumalai';   // matched against the WDPA 'NAME' field. CHECK the printed list.
var BOUNDARY_ASSET = '';                    // optional: path of your own boundary table asset, e.g. 'users/yourname/mudumalai'. Overrides WDPA.
var BOX = ee.Geometry.Rectangle([76.35, 11.50, 76.65, 11.75]);   // old approximate rectangle, used ONLY if USE_PARK_BOUNDARY = false
var YEARS = [2021, 2022, 2023];     // target years. Last one is the time holdout (TEST_YEAR). Add 2024 only if HANSEN_ID has it.
var TEST_YEAR = YEARS[YEARS.length - 1];
var FEATURE_LAG = 1;                // 1 = strictly before the label year (recommended). See the header.
var WINDOW_START = '01-01';         // fixed seasonal window (month-day), identical in every year.
var WINDOW_END = '03-31';           // Chosen for few clouds; NOT assumed to be "the dry season" - see the rainfall print.
var CLIM_START = 2001;              // baseline years for rainfall/temperature anomalies. Must end before the
var CLIM_END = 2018;                // earliest feature window (checked below).
var HANSEN_ID = 'UMD/hansen/global_forest_change_2023_v1_11';    // newer: 'UMD/hansen/global_forest_change_2024_v1_12'
var FOREST_MIN_COVER = 30;          // % tree cover in the year 2000 for a pixel to count as forest
var N_POINTS = 12000;               // uniform random forest pixels before de-duplication and edge trimming
var BLOCK_DEG = 0.03;               // spatial block size in degrees (about 3.3 km; the park is smaller than the old box)
var EDGE_MARGIN_DEG = 0.002;        // dropped strip along every block edge (about 220 m)
var EVAL_BLOCK_FRACTION = 0.25;     // share of blocks held out for spatial evaluation
var ENRICH_TRAIN_WITH_LOSS = false; // see header. Default OFF.
var N_ENRICH = 1500;
var DROP_PRIOR_LOSS = true;         // drop rows whose location was already lost before year y
var MIN_CLEAR_OBS = 2;              // minimum cloud-free Sentinel-2 observations at the point in each window
var MIN_POSITIVES_TOTAL = 100;      // warnings only; nothing is generated to reach these
var MIN_POSITIVES_TRAIN = 60;
var MIN_POSITIVES_TEST = 20;
var RUN_DIAGNOSTIC = true;          // fast check on a few points: which field is null, and why (prints in seconds)
var DIAG_N = 40;                    // number of points used by the diagnostic
var RUN_QA_PRINTS = true;           // set false if the Console summary times out; the QA csv export still works
var SEED = 42;
// =================================================================================

// ---------- sanity checks on the settings ----------
if (FEATURE_LAG !== 0 && FEATURE_LAG !== 1) { throw new Error('FEATURE_LAG must be 0 or 1'); }
if (CLIM_END >= YEARS[0] - FEATURE_LAG) { throw new Error('CLIM_END must be earlier than the earliest feature window year (' + (YEARS[0] - FEATURE_LAG) + ')'); }

// ---------- study area ----------
var STUDY_AREA, AOI;
if (USE_PARK_BOUNDARY) {
  var parkFc = BOUNDARY_ASSET ? ee.FeatureCollection(BOUNDARY_ASSET)
                              : ee.FeatureCollection('WCMC/WDPA/current/polygons').filter(ee.Filter.stringContains('NAME', BOUNDARY_NAME_CONTAINS));
  var nPark = parkFc.size().getInfo();
  if (nPark === 0) {
    throw new Error('No boundary polygon found (name contains "' + BOUNDARY_NAME_CONTAINS + '"). Search the Data Catalog for WCMC/WDPA/current/polygons, ' +
                    'change BOUNDARY_NAME_CONTAINS, supply BOUNDARY_ASSET, or set USE_PARK_BOUNDARY = false to use the rectangle.');
  }
  STUDY_AREA = parkFc.geometry().dissolve(100);
  print('Boundary polygons used (' + nPark + '). Check these are the Mudumalai protected area(s) you want; all matches are merged:',
        BOUNDARY_ASSET ? parkFc : parkFc.select(['NAME', 'DESIG_ENG', 'STATUS', 'REP_AREA'], null, false));
} else {
  STUDY_AREA = BOX;
}
AOI = STUDY_AREA.bounds();                       // bounding box, used only to filter satellite scenes
print('Study area, km2:', STUDY_AREA.area(100).divide(1e6));

var hansen = ee.Image(HANSEN_ID);
var lossyear = hansen.select('lossyear');                      // 0 = no loss, v = loss in year 2000 + v
var forest = hansen.select('treecover2000').gte(FOREST_MIN_COVER);

// ---------- date helpers (window end is exclusive: the day after WINDOW_END) ----------
function winStart(yr) { return ee.Date(yr + '-' + WINDOW_START); }
function winEnd(yr) { return ee.Date(yr + '-' + WINDOW_END).advance(1, 'day'); }
function trailing12(yr) { var e = winEnd(yr); return {start: e.advance(-12, 'month'), end: e}; }   // 12 months ending with window of yr

// ---------- sampling: one uniform sample, block ids, train/eval assignment ----------
function addGeo(f) {
  var c = f.geometry().coordinates();
  var lon = ee.Number(c.get(0)), lat = ee.Number(c.get(1));
  var cx = lon.divide(BLOCK_DEG).floor(), cy = lat.divide(BLOCK_DEG).floor();
  var fx = lon.divide(BLOCK_DEG).subtract(cx), fy = lat.divide(BLOCK_DEG).subtract(cy);   // position inside block, 0..1
  var m = EDGE_MARGIN_DEG / BLOCK_DEG;
  var inside = fx.gte(m).and(fx.lt(1 - m)).and(fy.gte(m)).and(fy.lt(1 - m));
  var h = cx.multiply(12.9898).add(cy.multiply(78.233)).sin().multiply(43758.5453).abs();  // fixed pseudo-random value per block
  var u = h.subtract(h.floor());
  var key = lon.format('%.5f').cat('_').cat(lat.format('%.5f'));
  return f.set({
    lon: lon, lat: lat, pkey: key, point_id: key,
    block_id: cx.format('%.0f').cat('_').cat(cy.format('%.0f')),
    inside_block: inside,
    spatial_split: ee.Algorithms.If(u.lt(EVAL_BLOCK_FRACTION), 'eval', 'train')
  });
}
function tag(source) { return function (f) { return f.set('sample_source', source); }; }

var sampled = forest.selfMask().rename('f').sample({region: STUDY_AREA, scale: 30, numPixels: N_POINTS, seed: SEED, geometries: true});
var geoPts = sampled.map(addGeo);
var dedup = geoPts.distinct('pkey');                                              // remove repeated pixels
var mainPts = dedup.filter(ee.Filter.eq('inside_block', 1)).map(tag('uniform_random'));

var pts = mainPts;
if (ENRICH_TRAIN_WITH_LOSS) {
  // loss pixels from years BEFORE the test year only, train blocks only, not within 60 m of a uniform point
  var lossMask = lossyear.gte(YEARS[0] - 2000).and(lossyear.lte(TEST_YEAR - 1 - 2000)).and(forest);
  var enrich = lossMask.selfMask().rename('l').sample({region: STUDY_AREA, scale: 30, numPixels: N_ENRICH, seed: SEED + 1, geometries: true})
    .map(addGeo).distinct('pkey')
    .filter(ee.Filter.eq('inside_block', 1)).filter(ee.Filter.eq('spatial_split', 'train'));
  var near = ee.Filter.withinDistance({distance: 60, leftField: '.geo', rightField: '.geo', maxError: 10});
  enrich = ee.Join.inverted().apply(enrich, mainPts, near).map(tag('loss_enrichment'));
  pts = mainPts.merge(enrich);
}

// ---------- Sentinel-2 / Sentinel-1 / climate building blocks ----------
function s2Collection(yr) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(AOI)
    .filterDate(winStart(yr), winEnd(yr))
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70));
}
function s2Stats(yr) {
  var col = s2Collection(yr).map(function (im) {          // drop no-data, defective, shadow, cloud, cirrus, snow
    var scl = im.select('SCL');
    var ok = scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
    return im.updateMask(ok);
  });
  var med = col.median();
  return ee.Image.cat([
    med.normalizedDifference(['B8', 'B4']).rename('ndvi'),
    med.normalizedDifference(['B8', 'B12']).rename('nbr'),
    col.select('B8').count().unmask(0).rename('clear')    // number of cloud-free observations at the pixel
  ]);
}
function s1Collection(yr) {
  return ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(AOI)
    .filterDate(winStart(yr), winEnd(yr))
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));
}
function s1Stats(yr) {                                    // mixed ascending/descending passes are used together
  return s1Collection(yr).select(['VV', 'VH']).median().rename(['vv', 'vh']);
}
function rain12(yr) {                                     // total rainfall (mm) in the 12 months ending with window of yr
  var t = trailing12(yr);
  return ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(t.start, t.end).sum().select([0]).rename('rain');
}
function temp12(yr) {                                     // mean 2 m air temperature (K) over the same 12 months
  var t = trailing12(yr);
  return ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR').filterDate(t.start, t.end).select('temperature_2m').mean().rename('temp');
}
function fire12(yr) {                                     // days with a MODIS thermal anomaly in the same 12 months (1 km pixel)
  var t = trailing12(yr);
  return ee.ImageCollection('FIRMS').filterDate(t.start, t.end).select('T21').count().select([0]).unmask(0).rename('fire');
}
// climatology: the same trailing-12-month window for each baseline year (all earlier than any feature window)
var climYears = [];
for (var c = CLIM_START; c <= CLIM_END; c++) { climYears.push(c); }
var RAIN_CLIM = ee.ImageCollection.fromImages(climYears.map(rain12)).mean();
var TEMP_CLIM = ee.ImageCollection.fromImages(climYears.map(temp12)).mean();
var TERRAIN = ee.Terrain.products(ee.Image('USGS/SRTMGL1_003'));

// ---------- one feature image per target year (uses windows R and O only) ----------
function featuresFor(y) {
  var R = y - FEATURE_LAG, O = R - 1;
  var a = s2Stats(R), b = s2Stats(O);
  var ra = s1Stats(R), rb = s1Stats(O);
  return ee.Image.cat([
    a.select('ndvi').subtract(b.select('ndvi')).rename('d_ndvi'),
    a.select('nbr').subtract(b.select('nbr')).rename('d_nbr'),
    a.select('ndvi').rename('ndvi_prev'),
    a.select('nbr').rename('nbr_prev'),
    ra.select('vv').subtract(rb.select('vv')).rename('d_vv'),
    ra.select('vh').subtract(rb.select('vh')).rename('d_vh'),
    rain12(R).subtract(RAIN_CLIM).rename('rain_anom_12m'),
    temp12(R).subtract(TEMP_CLIM).rename('temp_anom_12m'),
    fire12(R).rename('fire_days_12m'),
    TERRAIN.select('elevation'),
    TERRAIN.select('slope'),
    a.select('clear').rename('qa_s2_clear_recent'),
    b.select('clear').rename('qa_s2_clear_older'),
    lossyear.rename('lossyear_raw')                       // used only to build the label and the prior-loss flag
  ]);
}
var REQUIRED = ['d_ndvi', 'd_nbr', 'ndvi_prev', 'nbr_prev', 'd_vv', 'd_vh', 'rain_anom_12m', 'temp_anom_12m', 'fire_days_12m', 'elevation', 'slope'];

// reduceRegions can leave a property absent OR set it to null when no valid pixel lies under the point.
// Both cases are treated as "no value" (a null reaching a Number operation is what broke the first QA run).
function isNull(f, name) { return ee.Algorithms.IsEqual(f.get(name), null); }
var ALL_FIELDS = REQUIRED.concat(['lossyear_raw']);   // every field a row needs; each gets its own missing count

function numOr(f, name, dflt) { return ee.Number(ee.Algorithms.If(isNull(f, name), dflt, f.get(name))); }

var perYear = YEARS.map(function (y) {
  var R = y - FEATURE_LAG, O = R - 1;
  var rows = featuresFor(y).reduceRegions({collection: pts, reducer: ee.Reducer.mean(), scale: 30, tileScale: 8});
  var isTestYear = (y === TEST_YEAR);
  var nS2R = s2Collection(R).size(), nS2O = s2Collection(O).size();
  var nS1R = s1Collection(R).size(), nS1O = s1Collection(O).size();
  return rows.map(function (f) {
    var ly = numOr(f, 'lossyear_raw', 0);
    var missing = ee.Number(ee.List(REQUIRED.concat(['lossyear_raw']).map(function (n) { return ee.Algorithms.If(isNull(f, n), 1, 0); })).reduce(ee.Reducer.sum()));
    var lowObs = numOr(f, 'qa_s2_clear_recent', 0).lt(MIN_CLEAR_OBS).or(numOr(f, 'qa_s2_clear_older', 0).lt(MIN_CLEAR_OBS));
    var flags = {};                                       // one 0/1 flag per field: 1 = value is null or absent
    ALL_FIELDS.forEach(function (n) { flags['miss_' + n] = ee.Algorithms.If(isNull(f, n), 1, 0); });
    var isEval = ee.String(f.get('spatial_split')).compareTo('eval').eq(0);
    var role = ee.Algorithms.If(isTestYear,
      ee.Algorithms.If(isEval, 'test_spatial_temporal', 'test_temporal'),
      ee.Algorithms.If(isEval, 'test_spatial', 'train'));
    return f.set(flags).set({
      year: y,                                            // split key only - never a model input
      window_recent: R, window_older: O,
      lost_in_year: ly.eq(y - 2000),                      // LABEL (Hansen loss recorded in calendar year y)
      lost_before: ly.gt(0).and(ly.lt(y - 2000)),         // already lost in an earlier year
      is_missing: missing.gt(0), low_obs: lowObs, role: role,
      qa_n_s2_recent: nS2R, qa_n_s2_older: nS2O, qa_n_s1_recent: nS1R, qa_n_s1_older: nS1O
    });
  });
});
var allRows = ee.FeatureCollection(perYear).flatten();

// ---------- rows kept for export ----------
var keep = [ee.Filter.eq('is_missing', 0), ee.Filter.eq('low_obs', 0)];
if (DROP_PRIOR_LOSS) { keep.push(ee.Filter.eq('lost_before', 0)); }
// enriched rows may only appear in training rows - every test role stays representative
keep.push(ee.Filter.or(ee.Filter.eq('sample_source', 'uniform_random'), ee.Filter.eq('role', 'train')));
var finalRows = allRows.filter(ee.Filter.and.apply(null, keep));

// ---------- data-quality checks ----------
var ROLES = ['train', 'test_spatial', 'test_temporal', 'test_spatial_temporal'];
function pos(fc) { return fc.aggregate_sum('lost_in_year'); }
var qaObj = {
  points_sampled_raw: sampled.size(),
  points_after_dedupe: dedup.size(),
  points_after_edge_trim_and_enrichment: pts.size(),
  points_train_blocks: pts.filter(ee.Filter.eq('spatial_split', 'train')).size(),
  points_eval_blocks: pts.filter(ee.Filter.eq('spatial_split', 'eval')).size(),
  rows_total_before_filters: allRows.size(),
  rows_with_missing_feature: allRows.filter(ee.Filter.eq('is_missing', 1)).size(),
  rows_with_too_few_clear_s2_obs: allRows.filter(ee.Filter.eq('low_obs', 1)).size(),
  rows_removed_previous_loss: allRows.filter(ee.Filter.eq('lost_before', 1)).size(),
  rows_final: finalRows.size(),
  positives_final: pos(finalRows),
  negatives_final: finalRows.size().subtract(pos(finalRows))
};
ROLES.forEach(function (r) {
  var fc = finalRows.filter(ee.Filter.eq('role', r));
  qaObj['rows_' + r] = fc.size();
  qaObj['positives_' + r] = pos(fc);
});
YEARS.forEach(function (y) {
  var fc = finalRows.filter(ee.Filter.eq('year', y));
  qaObj['rows_year_' + y] = fc.size();
  qaObj['positives_year_' + y] = pos(fc);
});
ALL_FIELDS.forEach(function (n) {                       // missing count reported separately for EVERY required field
  qaObj['rows_missing_' + n] = allRows.filter(ee.Filter.eq('miss_' + n, 1)).size();
});
var qa = ee.Dictionary(qaObj);

// Sentinel scene counts for every window year that is used
var winYears = [];
YEARS.forEach(function (y) {
  [y - FEATURE_LAG, y - FEATURE_LAG - 1].forEach(function (w) { if (winYears.indexOf(w) < 0) { winYears.push(w); } });
});
winYears.sort();
print('Window years used (' + WINDOW_START + ' to ' + WINDOW_END + ') and raw scene counts. A zero here will make the export fail:',
  ee.List(winYears.map(function (w) { return ee.Dictionary({window_year: w, sentinel2_scenes: s2Collection(w).size(), sentinel1_scenes: s1Collection(w).size()}); })));

// Is this window actually low-rain? Check instead of assuming.
var nClim = CLIM_END - CLIM_START + 1;
var monthly = {};
for (var m = 1; m <= 12; m++) {
  var img = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(CLIM_START + '-01-01', (CLIM_END + 1) + '-01-01')
    .filter(ee.Filter.calendarRange(m, m, 'month')).sum().divide(nClim).select([0]);
  monthly['month_' + (m < 10 ? '0' : '') + m] = img.reduceRegion({reducer: ee.Reducer.mean(), geometry: AOI, scale: 5566, maxPixels: 1e9}).values().get(0);
}
print('Mean monthly rainfall over the study area, mm (' + CLIM_START + '-' + CLIM_END + '). The fixed window is ' + WINDOW_START + ' to ' + WINDOW_END + '; judge from these numbers, the script does not assume it is dry:', ee.Dictionary(monthly));
print('Highest Hansen loss year found inside the study area (2000 + value). Must be >= the last target year:',
  lossyear.reduceRegion({reducer: ee.Reducer.max(), geometry: STUDY_AREA, scale: 30, maxPixels: 1e10}));

if (RUN_QA_PRINTS) {
  print('Data-quality summary (computing - this can take a minute or two)...');
  qa.evaluate(function (q, err) {
    if (err) { print('QA summary failed or timed out (' + err + '). Set RUN_QA_PRINTS = false; the QA csv export will still give you the numbers.'); return; }
    print('DATA-QUALITY SUMMARY', q);
    var prev = q.rows_final > 0 ? (100 * q.positives_final / q.rows_final).toFixed(2) + '%' : 'n/a';
    print('Final rows: ' + q.rows_final + ' | positives: ' + q.positives_final + ' | negatives: ' + q.negatives_final + ' | loss prevalence: ' + prev);
    print('Rows dropped - missing feature: ' + q.rows_with_missing_feature + ', too few clear Sentinel-2 views: ' + q.rows_with_too_few_clear_s2_obs +
          ', location already lost earlier: ' + q.rows_removed_previous_loss + ' (counts overlap; ' + (DROP_PRIOR_LOSS ? 'previous-loss rows ARE dropped' : 'previous-loss rows are KEPT') + ')');
    var testPos = q.positives_test_spatial + q.positives_test_temporal + q.positives_test_spatial_temporal;
    if (q.positives_final < MIN_POSITIVES_TOTAL) { print('WARNING: only ' + q.positives_final + ' positive rows (< ' + MIN_POSITIVES_TOTAL + '). A model trained on this will be unreliable. Options: raise N_POINTS, widen the study area, add a year, or set ENRICH_TRAIN_WITH_LOSS = true (training rows only). No positives have been created artificially.'); }
    if (q.positives_train < MIN_POSITIVES_TRAIN) { print('WARNING: only ' + q.positives_train + ' positives in the training role (< ' + MIN_POSITIVES_TRAIN + ').'); }
    if (testPos < MIN_POSITIVES_TEST) { print('WARNING: only ' + testPos + ' positives across all test roles (< ' + MIN_POSITIVES_TEST + '). Test scores would be too noisy to trust.'); }
    if (q.rows_test_spatial_temporal === 0 || q.rows_test_spatial === 0 || q.rows_test_temporal === 0) { print('WARNING: one test role is empty - check BLOCK_DEG / EVAL_BLOCK_FRACTION / YEARS.'); }
  });
}

// ---------- fast diagnostic: which field is null, and why ----------
if (RUN_DIAGNOSTIC) {
  var y0 = YEARS[0], R0 = y0 - FEATURE_LAG, t0 = trailing12(R0);
  var firms0 = ee.ImageCollection('FIRMS').filterDate(t0.start, t0.end).select('T21');
  // two extra fire variants, ONLY for this diagnostic (the export above is unchanged):
  //   fire_raw_no_unmask      : the plain count, no unmask
  //   fire_alt_unmask_false   : unmask(0, false) = fill with 0 everywhere, not only inside the image footprint
  var diagImg = ee.Image.cat([
    featuresFor(y0),
    firms0.count().select([0]).rename('fire_raw_no_unmask'),
    firms0.count().select([0]).unmask(0, false).rename('fire_alt_unmask_false')
  ]);
  var diagPts = pts.randomColumn('dr', SEED).sort('dr').limit(DIAG_N);
  var diagRows = diagImg.reduceRegions({collection: diagPts, reducer: ee.Reducer.mean(), scale: 30, tileScale: 8});
  var diagFields = ALL_FIELDS.concat(['fire_raw_no_unmask', 'fire_alt_unmask_false']);
  var nullCounts = {}, nonNullCounts = {};
  diagFields.forEach(function (n) {
    nullCounts[n] = diagRows.map(function (f) { return f.set('m', ee.Algorithms.If(isNull(f, n), 1, 0)); }).aggregate_sum('m');
    nonNullCounts[n] = diagRows.aggregate_count(n);       // independent cross-check of the null test above
  });
  print('DIAGNOSTIC year ' + y0 + ' (feature windows ' + R0 + ' and ' + (R0 - 1) + '), points used:', diagRows.size());
  print('DIAGNOSTIC null count per field (out of the points above). Fields at the full count are the problem:', ee.Dictionary(nullCounts));
  print('DIAGNOSTIC non-null count per field (should equal points minus the null count):', ee.Dictionary(nonNullCounts));
  print('DIAGNOSTIC input availability for the 12-month window: FIRMS images, ERA5 monthly images (expect 12), CHIRPS daily images (expect ~365):',
    ee.Dictionary({
      firms_images: firms0.size(),
      era5_months: ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR').filterDate(t0.start, t0.end).size(),
      chirps_days: ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(t0.start, t0.end).size()
    }));
  print('DIAGNOSTIC band names of the feature image:', featuresFor(y0).bandNames());
  print('DIAGNOSTIC first 5 sampled rows (look for null / missing properties):', diagRows.limit(5));
}

// ---------- map ----------
Map.setOptions('SATELLITE');
Map.centerObject(STUDY_AREA, 10);
Map.addLayer(STUDY_AREA, {color: 'red'}, 'Study area (check this is Mudumalai)', true, 0.25);
Map.addLayer(pts.filter(ee.Filter.eq('spatial_split', 'train')), {color: '3b82f6'}, 'train-block points');
Map.addLayer(pts.filter(ee.Filter.eq('spatial_split', 'eval')), {color: 'ef4444'}, 'eval-block points');

// ---------- exports ----------
Export.table.toDrive({
  collection: finalRows,
  description: 'terrapulse_training_points',
  fileFormat: 'CSV',
  selectors: ['point_id', 'sample_source', 'block_id', 'spatial_split', 'role', 'year', 'window_recent', 'window_older', 'lon', 'lat',
              'lost_in_year', 'lost_before',
              'd_ndvi', 'd_nbr', 'ndvi_prev', 'nbr_prev', 'd_vv', 'd_vh', 'rain_anom_12m', 'temp_anom_12m', 'fire_days_12m', 'elevation', 'slope',
              'qa_s2_clear_recent', 'qa_s2_clear_older', 'qa_n_s2_recent', 'qa_n_s2_older', 'qa_n_s1_recent', 'qa_n_s1_older']
});
Export.table.toDrive({
  collection: ee.FeatureCollection([ee.Feature(null, qa)]),
  description: 'terrapulse_training_qa',
  fileFormat: 'CSV'
});
