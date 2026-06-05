/*
 *  OpenSCAD (www.openscad.org)
 *  Copyright (C) 2009-2011 Clifford Wolf <clifford@clifford.at> and
 *                          Marius Kintel <marius@kintel.net>
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  As a special exception, you have permission to link this program
 *  with the CGAL library and distribute executables, as long as you
 *  follow the requirements of the GNU GPL in regard to all of the
 *  software in the executable aside from CGAL.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
 */

#include "geometry/PolySetBuilder.h"

#include "geometry/Geometry.h"
#include "geometry/PolySet.h"
#include "geometry/linalg.h"
#include "utils/printutils.h"

#ifdef ENABLE_CGAL
#include "geometry/cgal/CGALNefGeometry.h"
#include "geometry/cgal/cgalutils.h"
#endif
#ifdef ENABLE_MANIFOLD
#include "geometry/manifold/ManifoldGeometry.h"
#endif

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <memory>
#include <utility>
#include <vector>

PolySetBuilder::PolySetBuilder(int vertices_count, int indices_count, int dim, boost::tribool convex)
  : dim_(dim), convex_(convex)
{
  reserve(vertices_count, indices_count);
}

void PolySetBuilder::reserve(int vertices_count, int indices_count)
{
  if (vertices_count != 0) vertices_.reserve(vertices_count);
  if (indices_count != 0) indices_.reserve(indices_count);
}

void PolySetBuilder::setConvexity(int convexity)
{
  convexity_ = convexity;
}

void PolySetBuilder::addColor(const Color4f& color, float roughness, float metalness, float clearcoat, float clearcoatRoughness, float sheen, const Color4f& sheenColor, float sheenRoughness, float transmission, float thickness, const Color4f& attenuationColor, float attenuationDistance, float ior, const Color4f& emissive, float emissiveIntensity, const Color4f& specularColor, float specularIntensity, float iridescence, float iridescenceIOR, float autoSmoothAngle, std::shared_ptr<const class Value> colormap)
{
  colors_.push_back(color);
  roughnesses_.push_back(roughness);
  metalnesses_.push_back(metalness);
  clearcoats_.push_back(clearcoat);
  clearcoatRoughnesses_.push_back(clearcoatRoughness);
  sheens_.push_back(sheen);
  sheenColors_.push_back(sheenColor);
  sheenRoughnesses_.push_back(sheenRoughness);
  transmissions_.push_back(transmission);
  thicknesses_.push_back(thickness);
  attenuationColors_.push_back(attenuationColor);
  attenuationDistances_.push_back(attenuationDistance);
  iors_.push_back(ior);
  emissives_.push_back(emissive);
  emissiveIntensities_.push_back(emissiveIntensity);
  specularColors_.push_back(specularColor);
  specularIntensities_.push_back(specularIntensity);
  iridescences_.push_back(iridescence);
  iridescenceIORs_.push_back(iridescenceIOR);
  autoSmoothAngles_.push_back(autoSmoothAngle);
  colormaps_.push_back(colormap);
}

void PolySetBuilder::addColorIndex(const int32_t idx)
{
  color_indices_.push_back(idx);
}

int PolySetBuilder::numVertices() const
{
  return vertices_.size();
}

int PolySetBuilder::numPolygons() const
{
  return indices_.size();
}

bool PolySetBuilder::isEmpty() const
{
  return vertices_.size() == 0 && indices_.size() == 0;
}

int PolySetBuilder::vertexIndex(const Vector3d& pt)
{
  return vertices_.lookup(pt);
}

void PolySetBuilder::appendGeometry(const std::shared_ptr<const Geometry>& geom)
{
  if (const auto geomlist = std::dynamic_pointer_cast<const GeometryList>(geom)) {
    for (const Geometry::GeometryItem& item : geomlist->getChildren()) {
      appendGeometry(item.second);
    }
  } else if (const auto ps = std::dynamic_pointer_cast<const PolySet>(geom)) {
    appendPolySet(*ps);
#ifdef ENABLE_CGAL
  } else if (const auto N = std::dynamic_pointer_cast<const CGALNefGeometry>(geom)) {
    if (const auto ps = CGALUtils::createPolySetFromNefPolyhedron3(*(N->p3))) {
      appendPolySet(*ps);
    } else {
      LOG(message_group::Error, "Nef->PolySet failed");
    }
#endif  // ifdef ENABLE_CGAL
#ifdef ENABLE_MANIFOLD
  } else if (const auto mani = std::dynamic_pointer_cast<const ManifoldGeometry>(geom)) {
    appendPolySet(*mani->toPolySet());
#endif
  } else if (std::dynamic_pointer_cast<const Polygon2d>(geom)) {  // NOLINT(bugprone-branch-clone)
    assert(false && "Unsupported geometry");
  } else {  // NOLINT(bugprone-branch-clone)
    assert(false && "Not implemented");
  }
}

void PolySetBuilder::appendPolygon(const std::vector<int>& inds)
{
  beginPolygon(inds.size());
  for (int idx : inds) addVertex(idx);
  endPolygon();
}

void PolySetBuilder::appendPolygon(const std::vector<Vector3d>& polygon)
{
  beginPolygon(polygon.size());
  for (const auto& v : polygon) addVertex(v);
  endPolygon();
}

void PolySetBuilder::beginPolygon(int nvertices)
{
  endPolygon();
  current_polygon_.reserve(nvertices);
}

void PolySetBuilder::addVertex(int ind)
{
  // Ignore consecutive duplicate indices
  if (current_polygon_.empty() || (ind != current_polygon_.back() && ind != current_polygon_.front())) {
    current_polygon_.push_back(ind);
  }
}

void PolySetBuilder::addVertex(const Vector3d& v)
{
  addVertex(vertexIndex(v));
}

void PolySetBuilder::endPolygon(const Color4f& color, float roughness, float metalness, float clearcoat, float clearcoatRoughness, float sheen, const Color4f& sheenColor, float sheenRoughness, float transmission, float thickness, const Color4f& attenuationColor, float attenuationDistance, float ior, const Color4f& emissive, float emissiveIntensity, const Color4f& specularColor, float specularIntensity, float iridescence, float iridescenceIOR, float autoSmoothAngle, std::shared_ptr<const class Value> colormap)
{
  // FIXME: Should we check for self-touching polygons (non-consecutive duplicate indices)?

  // FIXME: Can we move? What would the state of current_polygon_ be after move?
  if (current_polygon_.size() >= 3) {
    indices_.push_back(current_polygon_);

    if (color.isValid()) {
      if (color_indices_.empty() && indices_.size() > 1) {
        color_indices_.resize(indices_.size() - 1, -1);
      }
      int match_idx = -1;
      for (size_t i = 0; i < colors_.size(); ++i) {
        if (colors_[i] == color && roughnesses_[i] == roughness && metalnesses_[i] == metalness &&
            clearcoats_[i] == clearcoat && clearcoatRoughnesses_[i] == clearcoatRoughness &&
            sheens_[i] == sheen && sheenColors_[i] == sheenColor && sheenRoughnesses_[i] == sheenRoughness &&
            transmissions_[i] == transmission && thicknesses_[i] == thickness &&
            attenuationColors_[i] == attenuationColor && attenuationDistances_[i] == attenuationDistance &&
            iors_[i] == ior && emissives_[i] == emissive && emissiveIntensities_[i] == emissiveIntensity &&
            specularColors_[i] == specularColor && specularIntensities_[i] == specularIntensity &&
            iridescences_[i] == iridescence && iridescenceIORs_[i] == iridescenceIOR &&
            autoSmoothAngles_[i] == autoSmoothAngle &&
            colormaps_[i] == colormap) {
          match_idx = i;
          break;
        }
      }
      if (match_idx == -1) {
        color_indices_.push_back(colors_.size());
        colors_.push_back(color);
        roughnesses_.push_back(roughness);
        metalnesses_.push_back(metalness);
        clearcoats_.push_back(clearcoat);
        clearcoatRoughnesses_.push_back(clearcoatRoughness);
        sheens_.push_back(sheen);
        sheenColors_.push_back(sheenColor);
        sheenRoughnesses_.push_back(sheenRoughness);
        transmissions_.push_back(transmission);
        thicknesses_.push_back(thickness);
        attenuationColors_.push_back(attenuationColor);
        attenuationDistances_.push_back(attenuationDistance);
        iors_.push_back(ior);
        emissives_.push_back(emissive);
        emissiveIntensities_.push_back(emissiveIntensity);
        specularColors_.push_back(specularColor);
        specularIntensities_.push_back(specularIntensity);
        iridescences_.push_back(iridescence);
        iridescenceIORs_.push_back(iridescenceIOR);
        autoSmoothAngles_.push_back(autoSmoothAngle);
        colormaps_.push_back(colormap);
      } else {
        color_indices_.push_back(match_idx);
      }
    } else if (!color_indices_.empty()) {
      // Keep alignment when colors are skipped
      color_indices_.push_back(-1);
    }
  }
  current_polygon_.clear();
}

void PolySetBuilder::appendPolySet(const PolySet& ps)
{
  std::vector<uint32_t> color_map;

  // Copy color indices lazily.
  if (!ps.color_indices.empty()) {
    // If we hadn't built color_indices_ yet, catch up / fill w/ -1.
    if (color_indices_.empty() && !indices_.empty()) {
      color_indices_.resize(indices_.size(), -1);
    }
    color_indices_.reserve(color_indices_.size() + ps.color_indices.size());

    auto nColors = ps.colors.size();
    color_map.resize(nColors);
    for (size_t i = 0; i < nColors; i++) {
      const auto& color = ps.colors[i];
      float roughness = ps.roughnesses.empty() ? 1.0f : ps.roughnesses[i];
      float metalness = ps.metalnesses.empty() ? 0.0f : ps.metalnesses[i];
      float clearcoat = ps.clearcoats.empty() ? 0.0f : ps.clearcoats[i];
      float clearcoatRoughness = ps.clearcoatRoughnesses.empty() ? 0.0f : ps.clearcoatRoughnesses[i];
      float sheen = ps.sheens.empty() ? 0.0f : ps.sheens[i];
      Color4f sheenColor;
      if (ps.sheenColors.empty()) {
        Vector4f v; v[0]=0; v[1]=0; v[2]=0; v[3]=1;
        sheenColor = v;
      } else {
        sheenColor = ps.sheenColors[i];
      }
      float sheenRoughness = ps.sheenRoughnesses.empty() ? 0.0f : ps.sheenRoughnesses[i];
      float transmission = ps.transmissions.empty() ? 0.0f : ps.transmissions[i];
      float thickness = ps.thicknesses.empty() ? 0.0f : ps.thicknesses[i];
      Color4f attenuationColor = ps.attenuationColors.empty() ? Vector4f(1, 1, 1, 1) : ps.attenuationColors[i];
      float attenuationDistance = ps.attenuationDistances.empty() ? 0.0f : ps.attenuationDistances[i];
      float ior = ps.iors.empty() ? 1.5f : ps.iors[i];
      Color4f emissive = ps.emissives.empty() ? Vector4f(0, 0, 0, 1) : ps.emissives[i];
      float emissiveIntensity = ps.emissiveIntensities.empty() ? 1.0f : ps.emissiveIntensities[i];
      Color4f specularColor = ps.specularColors.empty() ? Vector4f(1, 1, 1, 1) : ps.specularColors[i];
      float specularIntensity = ps.specularIntensities.empty() ? 1.0f : ps.specularIntensities[i];
      float iridescence = ps.iridescences.empty() ? 0.0f : ps.iridescences[i];
      float iridescenceIOR = ps.iridescenceIORs.empty() ? 1.3f : ps.iridescenceIORs[i];
      float autoSmoothAngle = ps.autoSmoothAngles.empty() ? 0.0f : ps.autoSmoothAngles[i];
      std::shared_ptr<const Value> colormap = ps.colormaps.empty() ? nullptr : ps.colormaps[i];

      // Find index of material in material vectors, or add it if it doesn't exist
      int match_idx = -1;
      for (size_t j = 0; j < colors_.size(); ++j) {
        if (colors_[j] == color && roughnesses_[j] == roughness && metalnesses_[j] == metalness &&
            clearcoats_[j] == clearcoat && clearcoatRoughnesses_[j] == clearcoatRoughness &&
            sheens_[j] == sheen && sheenColors_[j] == sheenColor && sheenRoughnesses_[j] == sheenRoughness &&
            transmissions_[j] == transmission && thicknesses_[j] == thickness &&
            attenuationColors_[j] == attenuationColor && attenuationDistances_[j] == attenuationDistance &&
            iors_[j] == ior && emissives_[j] == emissive && emissiveIntensities_[j] == emissiveIntensity &&
            specularColors_[j] == specularColor && specularIntensities_[j] == specularIntensity &&
            iridescences_[j] == iridescence && iridescenceIORs_[j] == iridescenceIOR &&
            autoSmoothAngles_[j] == autoSmoothAngle &&
            colormaps_[j] == colormap) {
          match_idx = j;
          break;
        }
      }
      if (match_idx == -1) {
        color_map[i] = colors_.size();
        colors_.push_back(color);
        roughnesses_.push_back(roughness);
        metalnesses_.push_back(metalness);
        clearcoats_.push_back(clearcoat);
        clearcoatRoughnesses_.push_back(clearcoatRoughness);
        sheens_.push_back(sheen);
        sheenColors_.push_back(sheenColor);
        sheenRoughnesses_.push_back(sheenRoughness);
        transmissions_.push_back(transmission);
        thicknesses_.push_back(thickness);
        attenuationColors_.push_back(attenuationColor);
        attenuationDistances_.push_back(attenuationDistance);
        iors_.push_back(ior);
        emissives_.push_back(emissive);
        emissiveIntensities_.push_back(emissiveIntensity);
        specularColors_.push_back(specularColor);
        specularIntensities_.push_back(specularIntensity);
        iridescences_.push_back(iridescence);
        iridescenceIORs_.push_back(iridescenceIOR);
        autoSmoothAngles_.push_back(autoSmoothAngle);
        colormaps_.push_back(colormap);
      } else {
        color_map[i] = match_idx;
      }
    }
  }

  reserve(numVertices() + ps.vertices.size(), numPolygons() + ps.indices.size());
  for (size_t p_idx = 0; p_idx < ps.indices.size(); ++p_idx) {
    const auto& poly = ps.indices[p_idx];
    beginPolygon(poly.size());
    for (const auto& ind : poly) {
      addVertex(ps.vertices[ind]);
    }

    // Process indices per-polygon to prevent rejected/degenerate polygons from desyncing materials
    if (current_polygon_.size() >= 3) {
      indices_.push_back(current_polygon_);

      int mapped_c_idx = -1;
      if (!ps.color_indices.empty()) {
        int original_c_idx = ps.color_indices[p_idx];
        if (original_c_idx >= 0 && original_c_idx < color_map.size()) {
          mapped_c_idx = color_map[original_c_idx];
        }
      }

      if (mapped_c_idx != -1) {
        if (color_indices_.empty() && indices_.size() > 1) {
          color_indices_.resize(indices_.size() - 1, -1);
        }
        color_indices_.push_back(mapped_c_idx);
      } else if (!color_indices_.empty()) {
        color_indices_.push_back(-1);
      }
    }
    current_polygon_.clear();
  }
}

std::unique_ptr<PolySet> PolySetBuilder::build()
{
  endPolygon();
  std::unique_ptr<PolySet> polyset;
  polyset = std::make_unique<PolySet>(dim_, convex_);
  vertices_.copy(std::back_inserter(polyset->vertices));
  polyset->indices = std::move(indices_);
  polyset->color_indices = std::move(color_indices_);
  polyset->colors = std::move(colors_);
  polyset->roughnesses = std::move(roughnesses_);
  polyset->metalnesses = std::move(metalnesses_);
  polyset->clearcoats = std::move(clearcoats_);
  polyset->clearcoatRoughnesses = std::move(clearcoatRoughnesses_);
  polyset->sheens = std::move(sheens_);
  polyset->sheenColors = std::move(sheenColors_);
  polyset->sheenRoughnesses = std::move(sheenRoughnesses_);
  polyset->transmissions = std::move(transmissions_);
  polyset->thicknesses = std::move(thicknesses_);
  polyset->attenuationColors = std::move(attenuationColors_);
  polyset->attenuationDistances = std::move(attenuationDistances_);
  polyset->iors = std::move(iors_);
  polyset->emissives = std::move(emissives_);
  polyset->emissiveIntensities = std::move(emissiveIntensities_);
  polyset->specularColors = std::move(specularColors_);
  polyset->specularIntensities = std::move(specularIntensities_);
  polyset->iridescences = std::move(iridescences_);
  polyset->iridescenceIORs = std::move(iridescenceIORs_);
  polyset->autoSmoothAngles = std::move(autoSmoothAngles_);
  polyset->colormaps = std::move(colormaps_);
  polyset->setConvexity(convexity_);
  bool is_triangular = true;
  for (const auto& face : polyset->indices) {
    if (face.size() > 3) {
      is_triangular = false;
      break;
    }
  }
  polyset->setTriangular(is_triangular);
  return polyset;
}
