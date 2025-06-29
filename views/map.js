import {Component, createRef, h} from 'preact'
import mapboxgl from 'mapbox-gl'
// Mapbox GL JS currently doesn't support SVG icons
import TRIP_SHAPE_ARROW_URL from '../assets/arrow.png'
import 'mapbox-gl/dist/mapbox-gl.css';

// const TRIP_SHAPE_ARROW_URL = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='100px' height='100px'%3E%3Cpath d='M10 15 L15 10 L70 50 L15 90 L10 85 L35 50 z' fill='%23e0e0e0' stroke='%23e0e0e0' stroke-width='10px' stroke-linejoin='round' /%3E%3C/svg%3E`

const VEHICLE_POINT_COLOR = [
	'case',
	['!=', ['get', 'delay'], null],
	[
		'interpolate',
		['linear'],
		['get', 'delay'],
		0, ['to-color', '#2ecc71'],
		90, ['to-color', '#eebb00'],
		210, ['to-color', '#ee2200'],
	],
	'#e0e0e0', // todo: pick better color?
]

const FOCUSED_TRIP_SHAPE_OPACITY = {
	base: .3,
	stops: [[9, .3], [15, .8]],
}

mapboxgl.accessToken = __MAPBOX_TOKEN__
// https://docs.mapbox.com/mapbox-gl-js/api/properties/#prewarm
setTimeout(() => {
	mapboxgl.prewarm()
}, 100)


// todo: sync map zoom & position with state
class MapView extends Component {
	constructor() {
		super()
		this.ref = createRef()
	}

	updateVehiclePositions() {
		const {feedData} = this.props.state
		const entities = feedData.entity || []
		const positions = entities.filter(e => e.vehicle && e.vehicle.position)

		if (positions.length === 0) {
			// todo: remove data source from existing map
			return;
		}

		const src = this.map.getSource('vehicle-positions')
		if (!src) return;
		src.setData({
			type: 'FeatureCollection',
			features: positions.map(entity => {
				const v = entity.vehicle.vehicle || {}
				const t = entity.vehicle.trip || {}
				return {
					type: 'Feature',
					properties: {
						vehicleId: v.id,
						vehicleLabel: v.label,
						vehicleLicensePlate: v.license_plate,
						trip_id: t.trip_id,
						route_id: t.route_id,
						start_date: t.start_date,
						start_time: t.start_time,
						delay: entity.vehicle.delay,
					},
					geometry: {
						type: 'Point',
						coordinates: [
							entity.vehicle.position.longitude,
							entity.vehicle.position.latitude,
						],
					},
				}
			}),
		})

		// fit map viewbox to data
		const crd0 = [
			positions[0].vehicle.position.longitude,
			positions[0].vehicle.position.latitude,
		]
		const bounds = new mapboxgl.LngLatBounds(crd0, crd0)
		for (const pos of positions) {
			bounds.extend([
				pos.vehicle.position.longitude,
				pos.vehicle.position.latitude,
			])
		}
		this.map.fitBounds(bounds, {padding: 50})
	}

	updateFocusedTripShape() {
		const {focusedTripShape} = this.props.state
		const src = this.map.getSource('focused-trip-shape')
		if (!src) return;

		if (focusedTripShape === null) {
			src.setData({type: 'FeatureCollection', features: []})
		} else {
			src.setData(focusedTripShape)
		}
	}

	updateFocusedVehiclePosition() {
		const {focusedVehiclePosition} = this.props.state
		const src = this.map.getSource('focused-vehicle-position')
		if (!src) return;

		if (focusedVehiclePosition === null) {
			src.setData({type: 'FeatureCollection', features: []})
		} else {
			src.setData(focusedVehiclePosition)
		}
	}

	updateMap() {
		if (!this.map) return;
		this.updateVehiclePositions()
		this.updateFocusedTripShape()
		this.updateFocusedVehiclePosition()
	}

	componentDidMount() {
		const {emit} = this.props

		this.map = new mapboxgl.Map({
			container: this.ref.current,
			// todo
			style: 'mapbox://styles/mapbox/dark-v10', // stylesheet location
			center: [-74.5, 40], // starting position [lng, lat]
			zoom: 9 // starting zoom
		})

		this.map.once('load', () => {
			this.map.addSource('vehicle-positions', {
				type: 'geojson',
				data: {type: 'FeatureCollection', features: []},
			})
			this.map.addLayer({
				id: 'vehicle-positions',
				source: 'vehicle-positions',
				type: 'circle',
				paint: {
					'circle-radius': {
						base: 1.5,
						stops: [[1, 1], [20, 35]],
					},
					'circle-color': VEHICLE_POINT_COLOR,
				},
			})

			let popup = null
			const showPopup = (e) => {
				const feature = e.features[0]
				if (!feature) return
				const props = feature.properties

				// Only show defined properties
				const addProp = (label, value, code = true) => {
					if (!value || value === 'null' || value === 'undefined') return ''
					const displayValue = code ? `<code>${value}</code>` : value
					return `${label}: ${displayValue}<br/>`
				}

				let vehicleSection = ''
				vehicleSection += addProp('ID', props.vehicleId)
				vehicleSection += addProp('Label', props.vehicleLabel)
				vehicleSection += addProp('License Plate', props.vehicleLicensePlate)

				let tripSection = ''
				tripSection += addProp('ID', props.trip_id)
				tripSection += addProp('Route', props.route_id)

				const startDate = props.start_date.match(/^(\d{4})(\d{2})(\d{2})$/)
				if (startDate && props.start_time) {
					const start = new Date(Date.parse(`${startDate[1]}-${startDate[2]}-${startDate[3]}T${props.start_time}`))
					// Default locale with short date/time
					tripSection += addProp('Start', new Intl.DateTimeFormat(undefined, {
						dateStyle: 'short',
						timeStyle: 'short',
					}).format(start), false)
				}

				let html = '<div>'
				if (vehicleSection) {
					html += '<b>Vehicle</b><br/>' + vehicleSection
				}
				if (tripSection) {
					html += '<b>Trip</b><br/>' + tripSection
				}
				html += '</div>'

				if (popup) popup.remove()
				popup = new mapboxgl.Popup({closeButton: false, closeOnClick: false})
					.setLngLat(e.lngLat)
					.setHTML(html)
					.addTo(this.map)
			}

			this.map.on('mouseenter', 'vehicle-positions', () => {
				this.map.getCanvas().style.cursor = 'pointer'
			})
			this.map.on('mouseleave', 'vehicle-positions', () => {
				this.map.getCanvas().style.cursor = ''
			})
			this.map.on('click', 'vehicle-positions', (e) => {
				const vehicleId = e.features[0]?.properties.vehicleId || null
				emit('focus-vehicle-id', vehicleId)
				const tripId = e.features[0]?.properties.trip_id || null
				emit('focus-trip-id', tripId)

				showPopup(e)
				const closeOnMapClick = () => {
					if (popup) { popup.remove(); popup = null }
					console.log('close popup on map click')
					this.map.off('click', closeOnMapClick)
				}
				this.map.on('click', closeOnMapClick)
			})

			this.map.addSource('focused-trip-shape', {
				type: 'geojson',
				data: null,
			})
			// todo: visualize bearing?
			this.map.addLayer({
				id: 'focused-trip-shape',
				source: 'focused-trip-shape',
				type: 'line',
				paint: {
					'line-width': {
						base: 1,
						stops: [[1, .6], [20, 4]],
					},
					'line-color': '#44a8eb',
					'line-opacity': FOCUSED_TRIP_SHAPE_OPACITY,
				},
			})

			// todo: instead show all active vehicles in their current orientation, according to the shape?
			const map = this.map
			map.loadImage(TRIP_SHAPE_ARROW_URL, (err, image) => {
				if (err) {
					console.error('failed to load trip shape arrow', err)
					return;
				}
				map.addImage('focused-trip-shape-arrow', image)
				map.addLayer({
					id: 'focused-trip-shape-arrows',
					type: 'symbol',
					source: 'focused-trip-shape',
					paint: {
						'icon-opacity': FOCUSED_TRIP_SHAPE_OPACITY,
					},
					layout: {
						'symbol-placement': 'line',
						'icon-ignore-placement': true,
						'icon-image': 'focused-trip-shape-arrow',
						'icon-size': .15,
					},
				})
			})

			this.map.addSource('focused-vehicle-position', {
				type: 'geojson',
				data: null,
			})
			// todo: visualize bearing?
			this.map.addLayer({
				id: 'focused-vehicle-position',
				source: 'focused-vehicle-position',
				type: 'circle',
				paint: {
					'circle-radius': {
						base: 5,
						stops: [[1, 5], [20, 100]],
					},
					'circle-color': VEHICLE_POINT_COLOR,
				},
			})

			this.updateMap()
		})
	}
	componentDidUpdate() {
		this.updateMap()
	}
	componentWillUnmount() {
		if (this.map) {
			this.map.remove()
			this.map = null
		}
	}

	render() {
		return (
			<div class="map" ref={this.ref}>
				{/*<div ref={this.ref} />*/}
			</div>
		)
	}
}

export default MapView
