"""Quality audit rules on hand-built records (synthetic test cases)."""

import pandas as pd

from vanasignal.quality import audit_occurrences

BBOX = (74.8, 8.1, 77.5, 12.8)


def base(**over):
    row = {
        "gbif_id": "1", "lat": 10.0, "lon": 76.0, "coordinate_uncertainty_m": 100.0,
        "event_date": "2010-01-01", "year": 2010, "basis_of_record": "PRESERVED_SPECIMEN",
        "issues": [], "dataset_key": "d", "license": "CC0_1_0",
    }
    row.update(over)
    return row


def audit(rows, threshold=5000.0):
    return audit_occurrences(pd.DataFrame(rows), BBOX, threshold)


def test_clean_record_has_full_weight():
    out, s = audit([base()])
    assert out.loc[0, "quality_status"] == "clean" and out.loc[0, "quality_weight"] == 1.0
    assert s["records_usable"] == 1


def test_missing_zero_invalid_and_outside_region_are_excluded():
    rows = [
        base(gbif_id="a", lat=None, lon=None),
        base(gbif_id="b", lat=0.0, lon=0.0),
        base(gbif_id="c", lat=95.0, lon=76.0),
        base(gbif_id="d", lat=40.0, lon=-74.0),  # outside study region
    ]
    out, s = audit(rows)
    assert list(out["quality_status"]) == ["excluded"] * 4
    assert list(out["quality_weight"]) == [0.0] * 4
    assert out.loc[0, "flag_missing_coordinates"] and out.loc[1, "flag_zero_coordinates"]
    assert out.loc[2, "flag_invalid_coordinates"] and out.loc[3, "flag_outside_study_region"]
    assert s["records_usable"] == 0


def test_duplicates_keep_first_by_gbif_id_and_flag_later_ones():
    rows = [base(gbif_id="10", lat=10.0, lon=76.0), base(gbif_id="11", lat=10.0, lon=76.0), base(gbif_id="12", lat=10.0, lon=76.0, event_date="2011-01-01")]
    out, _ = audit(rows)
    assert out.loc[0, "quality_status"] == "clean"
    assert out.loc[1, "quality_status"] == "excluded" and out.loc[1, "flag_duplicate"]
    assert out.loc[2, "quality_status"] == "clean", "different event date is not a duplicate"


def test_questionable_records_are_kept_at_reduced_weight():
    rows = [
        base(gbif_id="u", lat=10.0, lon=76.0, coordinate_uncertainty_m=9000.0),
        base(gbif_id="s", lat=10.1, lon=76.0, issues=["COORDINATE_ROUNDED", "PRESUMED_NEGATED_LATITUDE"]),
        base(gbif_id="f", lat=10.2, lon=76.0, basis_of_record="FOSSIL_SPECIMEN"),
        base(gbif_id="m", lat=10.3, lon=76.0, issues=["COORDINATE_ROUNDED"]),  # minor issue: informational only
    ]
    out, _ = audit(rows)
    assert list(out["quality_status"]) == ["questionable", "questionable", "questionable", "clean"]
    assert list(out["quality_weight"]) == [0.5, 0.5, 0.5, 1.0]
    assert out.loc[3, "flag_minor_gbif_issue"]


def test_unknown_uncertainty_is_informational_not_penalised():
    out, _ = audit([base(coordinate_uncertainty_m=None)])
    assert out.loc[0, "flag_unknown_uncertainty"] and out.loc[0, "quality_status"] == "clean"


def test_summary_reports_shares_and_warnings():
    rows = [base(gbif_id=str(i), lat=10.0 + i * 0.01, lon=76.0) for i in range(4)] + [base(gbif_id="x", lat=None, lon=None)]
    _, s = audit(rows)
    assert s["records_total"] == 5 and s["flag_counts"]["missing_coordinates"] == 1
    assert s["missing_coordinate_share"] == 0.2
    assert any("30" in w for w in s["warnings"]), "small-sample warning expected"
    assert s["license_counts"] == {"CC0_1_0": 5}


def test_empty_input_warns_it_is_not_absence_evidence():
    out, s = audit_occurrences(pd.DataFrame(columns=["gbif_id", "lat", "lon"]), BBOX)
    assert s["records_total"] == 0
    assert "not evidence of species absence" in s["warnings"][0]


def test_off_land_records_are_questionable_when_land_mask_given():
    from vanasignal.spatial import land_union
    land = land_union()
    assert land is not None, "vendored Natural Earth land mask must be present"
    # (lat 9.5, lon 75.5) is open Arabian Sea; (lat 10.0, lon 76.3) is inland Kerala
    rows = [base(gbif_id="sea", lat=9.5, lon=75.5), base(gbif_id="land", lat=10.0, lon=76.3)]
    out, s = audit_occurrences(pd.DataFrame(rows), BBOX, 5000.0, land=land)
    assert out.loc[0, "flag_off_land"] and out.loc[0, "quality_status"] == "questionable"
    assert out.loc[1, "quality_status"] == "clean"
    assert s["flag_counts"]["off_land"] == 1
    _, s_none = audit_occurrences(pd.DataFrame(rows), BBOX, 5000.0, land=None)
    assert s_none["flag_counts"]["off_land"] == 0
