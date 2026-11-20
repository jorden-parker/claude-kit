export const register = on => {
  on('session.start', async ($, e, next) => {
    await $.ui.open({ id: 'heat', title: 'Heatmap', focus: false })
    return next(e)
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    return Box({ borderStyle: 'rounded', backgroundColor: '#1e1e2e', children: [
      Text({ bold: true, color: '#ff5555', children: ['Heatmap'] }),
      Raster({ key: 'grid', columns: 40, rows: 8, cells }),
      Button({ key: 'btn', label: 'Refresh', onPress: refresh }),
      Button({ key: 'btn', label: 'Close', onPress: close }),
    ]})
  })
}
